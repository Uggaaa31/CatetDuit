import os
import time
import re
import logging
import requests
from bs4 import BeautifulSoup
from imapclient import IMAPClient
import mailparser

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [email-watcher] %(message)s"
)
logger = logging.getLogger("email-watcher")

IMAP_HOST = os.getenv("IMAP_HOST", "imap.gmail.com")
IMAP_PORT = int(os.getenv("IMAP_PORT", 993))
IMAP_USER = os.getenv("IMAP_USER", "").strip()
IMAP_PASSWORD = os.getenv("IMAP_PASSWORD", "").strip()
CHECK_INTERVAL = int(os.getenv("IMAP_CHECK_INTERVAL_SECONDS", 30))
FINANCE_API_URL = os.getenv("FINANCE_API_URL", "http://finance-api:3000")


def clean_html(html_content: str) -> str:
    soup = BeautifulSoup(html_content, "html.parser")
    return soup.get_text(separator=" ", strip=True)


def parse_bank_jago(subject: str, body: str, sender: str) -> dict:
    """
    Parser khusus untuk notifikasi transaksi dari Bank Jago (noreply@jago.com).
    Mendukung pembayaran QRIS/Merchant, Transfer, Bayar Tagihan, Top Up, dan Uang Masuk.
    """
    subject_clean = subject.replace("💸", "").strip()
    tx_type = "expense"
    merchant = "Merchant Jago"
    description = subject_clean

    # 1. Deteksi Tipe & Merchant dari Subjek
    # Contoh: "Kamu telah membayar ke SKAGE BANDANG MKS Restora"
    m_bayar = re.search(r"telah membayar ke\s+(.+)$", subject_clean, re.IGNORECASE)
    m_transfer = re.search(r"telah transfer ke\s+(.+)$", subject_clean, re.IGNORECASE)
    m_kirim = re.search(r"kirim uang ke\s+(.+)$", subject_clean, re.IGNORECASE)
    m_terima = re.search(r"(?:menerima uang dari|uang masuk dari)\s+(.+)$", subject_clean, re.IGNORECASE)
    m_topup = re.search(r"top up ke\s+(.+)$", subject_clean, re.IGNORECASE)
    m_tagihan = re.search(r"bayar tagihan\s+(.+)$", subject_clean, re.IGNORECASE)

    if m_bayar:
        merchant = m_bayar.group(1).strip()
        tx_type = "expense"
        description = f"Pembayaran ke {merchant}"
    elif m_transfer:
        merchant = m_transfer.group(1).strip()
        tx_type = "expense"
        description = f"Transfer ke {merchant}"
    elif m_kirim:
        merchant = m_kirim.group(1).strip()
        tx_type = "expense"
        description = f"Kirim uang ke {merchant}"
    elif m_topup:
        merchant = m_topup.group(1).strip()
        tx_type = "expense"
        description = f"Top up {merchant}"
    elif m_tagihan:
        merchant = m_tagihan.group(1).strip()
        tx_type = "expense"
        description = f"Bayar tagihan {merchant}"
    elif m_terima:
        merchant = m_terima.group(1).strip()
        tx_type = "income"
        description = f"Uang masuk dari {merchant}"

    # Jika merchant belum terdeteksi dari subjek, cari di body: "Ke <Nama>"
    if merchant == "Merchant Jago":
        body_ke_match = re.search(r"(?:Ke|Penerima|Tujuan)\s*[:\n]\s*([^\n\r0-9]{3,40})", body, re.IGNORECASE)
        if body_ke_match:
            merchant = body_ke_match.group(1).strip()
            description = f"Pembayaran ke {merchant}"

    # 2. Ekstrak Nominal dari Body Jago
    # Jago biasanya menulis: "Jumlah Rp35.000" atau "Total: Rp 35.000" atau tabel transaksi
    amount = extract_amount(body)
    if amount <= 0:
        amount = extract_amount(subject)

    return {
        "matched": True,
        "bankName": "Bank Jago",
        "source": "email_bank_jago",
        "type": tx_type,
        "amount": amount,
        "merchantName": merchant,
        "description": description,
    }


def extract_amount(text: str) -> float:
    # Pola: Rp 50.000 atau Rp. 50.000,00 atau IDR 50,000 atau Rp50.000
    patterns = [
        r"(?:rp\.?|idr)\s*([0-9]{1,3}(?:\.[0-9]{3})+(?:,[0-9]{2})?)",
        r"(?:rp\.?|idr)\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{2})?)",
        r"(?:sebesar|nominal|jumlah|total)\s*:?\s*(?:rp\.?|idr)?\s*([0-9]{1,3}(?:\.[0-9]{3})+)",
        r"(?:rp\.?|idr)\s*([0-9]+)",
    ]

    for p in patterns:
        match = re.search(p, text, re.IGNORECASE)
        if match:
            raw_val = match.group(1).replace(".", "").replace(",", "")
            # Jika ada 2 digit desimal di belakang
            if ",00" in match.group(1) or ".00" in match.group(1):
                raw_val = raw_val[:-2]
            try:
                val = float(raw_val)
                if val > 0:
                    return val
            except ValueError:
                continue

    return 0.0


def extract_merchant(text: str, subject: str) -> str:
    # Cek pola merchant di notifikasi QRIS / Bank umum
    merchant_patterns = [
        r"(?:membayar ke|pembayaran ke|transaksi di|transfer ke)\s+([A-Za-z0-9\s\.\-]{3,35})",
        r"(?:ke|di|merchant|penerima|toko|kepada)\s*[:\n]\s*([A-Za-z0-9\s\.\-]{3,35})",
    ]

    for p in merchant_patterns:
        m = re.search(p, subject, re.IGNORECASE)
        if m:
            clean = m.group(1).split("\n")[0].replace("💸", "").strip()
            if len(clean) > 2:
                return clean

    for p in merchant_patterns:
        m = re.search(p, text, re.IGNORECASE)
        if m:
            clean = m.group(1).split("\n")[0].replace("💸", "").strip()
            if len(clean) > 2:
                return clean

    return "QRIS / Bank Partner"


def infer_transaction_type(text: str, subject: str) -> str:
    combined = (subject + " " + text).lower()
    if any(k in combined for k in ["masuk", "diterima", "kredit", "credit", "top up masuk", "penjualan"]):
        return "income"
    return "expense"


def process_email_message(msg_data, client, msg_id):
    mail = mailparser.parse_from_bytes(msg_data[b"RFC822"])
    subject = mail.subject or ""
    sender = mail.from_[0][1] if mail.from_ else ""
    body = mail.text_plain[0] if mail.text_plain else ""

    if not body and mail.text_html:
        body = clean_html(mail.text_html[0])

    logger.info(f"Memeriksa email baru - Subjek: '{subject}' dari: {sender}")

    sender_lower = sender.lower()
    subject_lower = subject.lower()

    # Daftar keyword relevan transaksi
    keywords = [
        "qris", "pembayaran", "membayar", "transaksi", "penarikan",
        "transfer", "kirim uang", "uang masuk", "debet", "kredit",
        "dana bisnis", "bca", "gopay", "jago", "seabank", "bsi"
    ]
    is_known_bank_sender = any(b in sender_lower for b in ["jago.com", "bca.co.id", "bsi.co.id", "seabank.co.id", "dana.id", "shopee", "gopay"])
    is_relevant_subject = any(k in subject_lower for k in keywords)

    if not is_known_bank_sender and not is_relevant_subject:
        return

    # 1. Handle Khusus Bank Jago
    if "jago.com" in sender_lower or "jago" in subject_lower:
        parsed = parse_bank_jago(subject, body, sender)
        if parsed["amount"] > 0:
            payload = {
                "source": "email_bank_jago",
                "bankName": "Bank Jago",
                "type": parsed["type"],
                "amount": parsed["amount"],
                "description": parsed["description"],
                "merchantName": parsed["merchantName"],
                "notificationRaw": f"Subject: {subject}\nFrom: {sender}\n\n{body[:500]}",
            }
            send_to_finance_api(payload, client, msg_id, parsed["amount"], parsed["merchantName"])
            return

    # 2. Handle Bank / QRIS Lainnya Secara Umum
    amount = extract_amount(body + " " + subject)
    if amount <= 0:
        logger.warning("Tidak dapat mendeteksi nominal transaksi pada email ini.")
        return

    merchant = extract_merchant(body, subject)
    tx_type = infer_transaction_type(body, subject)

    payload = {
        "source": "email_qris",
        "bankName": "QRIS / Bank",
        "type": tx_type,
        "amount": amount,
        "description": f"{subject[:80]}",
        "merchantName": merchant,
        "notificationRaw": f"Subject: {subject}\nFrom: {sender}\n\n{body[:500]}",
    }
    send_to_finance_api(payload, client, msg_id, amount, merchant)


def send_to_finance_api(payload: dict, client, msg_id, amount: float, merchant: str):
    try:
        res = requests.post(f"{FINANCE_API_URL}/transactions", json=payload, timeout=10)
        if res.status_code in [200, 201]:
            logger.info(f"✅ Transaksi email berhasil dicatat: Rp {amount:,.0f} ({merchant})")
            client.add_flags(msg_id, ["\\Seen"])
        else:
            logger.error(f"Gagal simpan transaksi: {res.status_code} - {res.text}")
    except Exception as e:
        logger.error(f"Error mengirim transaksi ke finance-api: {e}")


def main():
    logger.info("Memulai service Email Watcher...")

    if not IMAP_USER or not IMAP_PASSWORD:
        logger.warning("⚠️ IMAP_USER atau IMAP_PASSWORD belum disetel di .env.")
        logger.warning("Fitur email watcher akan standby. Anda dapat mengisinya nanti jika ingin membaca email otomatis.")
        while True:
            time.sleep(60)

    while True:
        try:
            logger.info(f"Menghubungkan ke IMAP {IMAP_HOST}:{IMAP_PORT} sebagai {IMAP_USER}...")
            with IMAPClient(IMAP_HOST, port=IMAP_PORT, ssl=True) as client:
                client.login(IMAP_USER, IMAP_PASSWORD)
                client.select_folder("INBOX")
                logger.info("✅ Terhubung ke Inbox email. Memeriksa pesan baru...")

                while True:
                    unread_ids = client.search(["UNSEEN"])
                    if unread_ids:
                        logger.info(f"Ditemukan {len(unread_ids)} email belum dibaca.")
                        messages = client.fetch(unread_ids, ["RFC822"])
                        for msg_id, data in messages.items():
                            try:
                                process_email_message(data, client, msg_id)
                            except Exception as parse_err:
                                logger.error(f"Gagal memproses email ID {msg_id}: {parse_err}")

                    time.sleep(CHECK_INTERVAL)

        except Exception as conn_err:
            logger.error(f"Koneksi IMAP error: {conn_err}. Mencoba lagi dalam 30 detik...")
            time.sleep(30)


if __name__ == "__main__":
    main()
