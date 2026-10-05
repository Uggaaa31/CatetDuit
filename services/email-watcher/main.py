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


def extract_amount(text: str) -> float:
    # Pola: Rp 50.000 atau Rp. 50.000,00 atau IDR 50,000
    patterns = [
        r"(?:rp\.?|idr)\s*([0-9]{1,3}(?:\.[0-9]{3})+(?:,[0-9]{2})?)",
        r"(?:rp\.?|idr)\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{2})?)",
        r"(?:rp\.?|idr)\s*([0-9]+)",
        r"(?:sebesar|nominal|jumlah)\s*(?:rp\.?|idr)?\s*([0-9]{1,3}(?:\.[0-9]{3})+)",
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
    # Cek pola merchant di notifikasi QRIS / Bank
    merchant_patterns = [
        r"(?:ke|di|merchant|penerima|toko|kepada)\s*:\s*([A-Za-z0-9\s\.\-]{3,30})",
        r"(?:transaksi di|pembayaran ke)\s+([A-Za-z0-9\s\.\-]{3,30})",
    ]

    for p in merchant_patterns:
        m = re.search(p, text, re.IGNORECASE)
        if m:
            clean = m.group(1).split("\n")[0].strip()
            if len(clean) > 2:
                return clean

    return "QRIS / Bank Partner"


def infer_transaction_type(text: str, subject: str) -> str:
    combined = (subject + " " + text).lower()
    if any(k in combined for k in ["masuk", "diterima", "kredit", "credit", "top up", "penjualan"]):
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

    keywords = ["qris", "pembayaran", "transaksi", "penarikan", "transfer", "debet", "kredit", "dana bisnis", "bca", "gopay"]
    subject_lower = subject.lower()
    is_relevant = any(k in subject_lower for k in keywords)

    if not is_relevant:
        return

    amount = extract_amount(body + " " + subject)
    if amount <= 0:
        logger.warning("Tidak dapat mendeteksi nominal transaksi pada email ini.")
        return

    merchant = extract_merchant(body, subject)
    tx_type = infer_transaction_type(body, subject)

    payload = {
        "source": "email_qris",
        "type": tx_type,
        "amount": amount,
        "description": f"{subject[:80]}",
        "merchantName": merchant,
        "category": "Pembayaran QRIS / Bank",
        "notificationRaw": f"Subject: {subject}\nFrom: {sender}\n\n{body[:500]}",
    }

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
