import os
import re
import json
import logging
from typing import Optional, List
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from PIL import Image, ImageOps
import google.generativeai as genai

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ocr-service")

app = FastAPI(title="AI Receipt & M-Banking Extraction Service")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
    logger.info("Gemini AI Vision terkonfigurasi untuk OCR struk & resi m-banking.")
else:
    logger.warning("GEMINI_API_KEY belum disetel pada file .env.")

class ReceiptItem(BaseModel):
    name: str
    price: float
    qty: Optional[int] = 1

class OCRRequest(BaseModel):
    imageFilePath: str

class OCRResponse(BaseModel):
    receiptType: str = "struk_belanja"  # "struk_belanja" | "m_banking" | "qris"
    transactionType: str = "expense"    # "expense" | "income"
    bankName: Optional[str] = None
    merchantName: Optional[str] = "Toko / Penerima"
    recipientName: Optional[str] = None
    notes: Optional[str] = None
    totalAmount: float
    date: Optional[str] = None
    category: Optional[str] = "Belanja Bulanan"
    items: List[ReceiptItem] = []
    engine: str = "gemini"


def extract_with_gemini(image_path: str) -> dict:
    img = Image.open(image_path)
    img = ImageOps.exif_transpose(img)

    prompt = """
    Kamu adalah asisten analisis bukti pembayaran dan struk keuangan di Indonesia.
    Gambar yang diberikan bisa berupa:
    1. Tangkapan layar (screenshot) / resi transfer M-Banking atau E-Wallet (BCA Mobile, Livin by Mandiri, BRImo, BNI, BSI, Seabank, Jago, Blu, DANA, GoPay, OVO, ShopeePay, dll).
    2. Bukti pembayaran QRIS (via m-banking atau e-wallet).
    3. Struk belanja fisik (Indomaret, Alfamart, restoran, cafe, SPBU, toko retail, dll).

    Analisis gambar tersebut dengan teliti dan ekstrak dalam format JSON murni tanpa markdown (tanpa ```json atau ```):
    {
      "receiptType": "struk_belanja | m_banking | qris",
      "transactionType": "expense | income",
      "bankName": "nama bank atau e-wallet jika ada (contoh: BCA, Mandiri, BRImo, BNI, DANA, GoPay, ShopeePay)",
      "merchantName": "nama toko / merchant / penerima transfer",
      "recipientName": "nama pemilik rekening penerima jika bukti transfer antar-rekening",
      "notes": "berita transfer / catatan / keterangan jika ada",
      "totalAmount": 150000,
      "category": "Makanan & Minuman | Bensin & Transportasi | Kuota & Internet | Listrik, Air & Wifi | Belanja Bulanan | Nongkrong & Hiburan | Kirim Keluarga | Rokok & Vape | Dana Darurat | Tabungan",
      "items": [
        {"name": "nama item jika struk belanja", "price": 15000, "qty": 1}
      ]
    }

    Panduan penting:
    - totalAmount harus berupa angka desimal murni tanpa titik atau simbol Rp (contoh: 94500 atau 150000). Jika ada biaya admin, gunakan total nominal yang terpotong.
    - transactionType: jika transfer keluar / pembayaran / debit -> "expense". Jika bukti transfer masuk / dana diterima / kredit -> "income".
    - Kategori HARUS salah satu dari 10 kategori di atas. DILARANG menggunakan kategori 'Lain-lain'.
    - Jika ini resi M-Banking / Transfer:
      * Transfer ke orang tua / keluarga / saudara -> 'Kirim Keluarga'
      * Bayar tagihan PLN / listrik / PDAM / air / Wifi / Indihome -> 'Listrik, Air & Wifi'
      * Bayar pulsa / paket data -> 'Kuota & Internet'
      * Pembayaran QRIS restoran / warung makan / cafe / kopi -> 'Nongkrong & Hiburan' atau 'Makanan & Minuman'
      * Pembayaran di SPBU Pertamina -> 'Bensin & Transportasi'
      * Transfer ke rekening tabungan / deposito / investasi / SeaBank -> 'Tabungan'
      * Jika pengeluaran medis / obat / darurat -> 'Dana Darurat'
      * Jika belanja umum minimarket / toko -> 'Belanja Bulanan'
    - Jika ini struk belanja fisik yang memiliki daftar barang belanjaan, masukkan seluruh item ke dalam array items.
    """

    models_to_try = ["gemini-flash-latest", "gemini-3.8-flash", "gemini-2.5-flash-lite"]
    last_err = None

    for m_name in models_to_try:
        try:
            logger.info(f"Mencoba ekstraksi dengan model: {m_name}")
            model = genai.GenerativeModel(m_name)
            response = model.generate_content([prompt, img])
            raw_text = response.text.strip()

            clean_json = re.sub(r"^```(?:json)?\s*", "", raw_text, flags=re.MULTILINE)
            clean_json = re.sub(r"\s*```$", "", clean_json, flags=re.MULTILINE).strip()

            data = json.loads(clean_json)

            normalized_items = []
            for item in data.get("items", []):
                qty = item.get("qty") or item.get("quantity") or 1
                normalized_items.append({
                    "name": item.get("name", "Barang"),
                    "price": float(item.get("price", 0)),
                    "qty": int(qty)
                })
            data["items"] = normalized_items

            return data
        except Exception as e:
            logger.warning(f"Model {m_name} gagal: {e}")
            last_err = e

    raise last_err or Exception("Semua model Gemini gagal merespons.")


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "gemini_enabled": bool(GEMINI_API_KEY)
    }


@app.post("/ocr/extract", response_model=OCRResponse)
def extract_receipt(payload: OCRRequest):
    if not os.path.exists(payload.imageFilePath):
        raise HTTPException(status_code=404, detail=f"File gambar tidak ditemukan: {payload.imageFilePath}")

    if not GEMINI_API_KEY:
        raise HTTPException(status_code=400, detail="GEMINI_API_KEY belum disetel pada file .env.")

    try:
        result = extract_with_gemini(payload.imageFilePath)
        return OCRResponse(
            receiptType=result.get("receiptType", "struk_belanja"),
            transactionType=result.get("transactionType", "expense"),
            bankName=result.get("bankName"),
            merchantName=result.get("merchantName") or result.get("recipientName") or "Toko / Penerima",
            recipientName=result.get("recipientName"),
            notes=result.get("notes"),
            totalAmount=float(result.get("totalAmount", 0)),
            date=result.get("date"),
            category=result.get("category", "Belanja Bulanan"),
            items=[ReceiptItem(**i) for i in result.get("items", [])],
            engine="gemini"
        )
    except Exception as e:
        logger.error(f"Gagal memproses struk dengan Gemini AI: {e}")
        raise HTTPException(status_code=500, detail=f"Gagal memproses gambar struk/resi: {str(e)}")


class ChatParseRequest(BaseModel):
    text: str
    senderName: Optional[str] = "User"


class AITransactionItem(BaseModel):
    type: str = "expense"  # "expense" | "income"
    amount: float
    description: str
    category: str
    merchantName: Optional[str] = None


class AITransferInfo(BaseModel):
    isTransfer: bool = False
    transferType: Optional[str] = None  # "seabank_bundle" | "bank_to_bank" | "category_pocket"
    amount: float = 0.0
    fromBank: Optional[str] = None
    toTarget: Optional[str] = None
    category: Optional[str] = None
    notes: Optional[str] = None


class ChatParseResponse(BaseModel):
    isFinancial: bool = False
    intent: str = "general_chat"  # "transaction" | "transfer" | "general_chat"
    transactions: List[AITransactionItem] = []
    transfer: Optional[AITransferInfo] = None
    friendlyResponse: Optional[str] = None
    engine: str = "gemini"


def parse_chat_with_gemini(user_text: str, sender_name: str = "User") -> dict:
    prompt = f"""
    Kamu adalah asisten keuangan pribadi cerdas, ramah, dan solutif di Indonesia untuk bot WhatsApp 'CatetDuit'.
    Pengguna ({sender_name}) mengirim pesan obrolan berikut:
    "{user_text}"

    TUGAS UTAMA:
    Pahami maksud dan bahasa santai/gaul/cerita pengguna.
    Tentukan apakah pesan ini memuat informasi transaksi keuangan (pengeluaran, pemasukan, atau pemindahan saldo) atau sekadar sapaan/obrolan/pertanyaan seputar keuangan.

    ATURAN KATEGORI (WAJIB DIPATUHI):
    Kategori transaksi HARUS salah satu dari 10 kategori resmi berikut (DILARANG KERAS menggunakan kategori 'Lain-lain' atau kategori buatan sendiri):
    1. "Makanan & Minuman" -> sarapan, makan siang, makan malam, jajanan, snack, resto, warteg, padang, indomie, martabak, es teh, jus, kopi sachet, gofood/shopeefood/grabfood
    2. "Rokok & Vape" -> rokok (surya, sampoerna, marlboro, dll), pods, liquid, coil, tembakau, korek
    3. "Bensin & Transportasi" -> bensin (pertalite, pertamax), ojek online (gojek, grab, maxim), tarif tol, karcis parkir, servis motor/mobil, ganti oli, cuci kendaraan
    4. "Kuota & Internet" -> pulsa seluler, paket data internet (telkomsel, indosat, xl, tri, smartfren)
    5. "Listrik, Air & Wifi" -> tagihan PLN, token listrik, PDAM, air galon isi ulang, tagihan Wifi/Indihome/Biznet
    6. "Belanja Bulanan" -> kebutuhan rumah tangga, sabun, odol, shampoo, deterjen, belanja minimarket/supermarket (Indomaret, Alfamart), pakaian, perlengkapan diri
    7. "Nongkrong & Hiburan" -> cafe, nongki bareng kawan, kopi kekinian (Janji Jiwa, Kopi Kenangan, Starbucks), bioskop, nonton, top up game (MLBB, FF, Steam), liburan, jalan-jalan
    8. "Kirim Keluarga" -> kirim uang orang tua/mama/bapak/ibu, uang saku adik/saudara/keluarga
    9. "Dana Darurat" -> biaya darurat tak terduga, beli obat di apotek, periksa dokter, ke klinik, biaya servis darurat
    10. "Tabungan" -> simpanan masa depan, investasi, reksadana, bibit, beli emas, deposito

    ATURAN TRANSAKSI:
    - Jika pengguna menyebutkan satu atau beberapa pengeluaran dalam satu cerita (contoh: "tadi makan sate 45rb terus beli rokok surya 35rb di indomaret"):
      Ekstrak SEMUA transaksi tersebut secara terpisah ke dalam array 'transactions'!
    - type: "expense" (pengeluaran) atau "income" (pemasukan).
    - amount: angka desimal murni dalam Rupiah (contoh: 25k -> 25000, 1.2jt -> 1200000, 45 ribu -> 45000).
    - description: ringkasan nama barang/aktivitas yang dibeli (singkat dan rapi, jangan masukkan kata obrolan seperti 'tadi siang gue').
    - merchantName: nama toko/merchant/tempat jika ada (contoh: 'Indomaret', 'Kopi Kenangan', 'Warteg'), jika tidak ada set null.

    ATURAN PEMINDAHAN REKENING & SALDO:
    Pengguna memiliki sistem pembagian rekening:
    - BSI: Rekening uang masuk / gaji utama.
    - SeaBank: Rekening tabungan & dana darurat. (Transfer 800rb ke SeaBank = 500k Dana Darurat + 300k Tabungan).
    - Bank Jago: Rekening operasional harian, belanja, dan kirim orang tua.
    Jika pesan adalah pemindahan dana (misal: "pindahkan 800rb ke seabank", "pindah 3.3jt ke jago", "transfer 400rb ke ortu"):
    - isFinancial = true, intent = "transfer".
    - transfer.isTransfer = true
    - transferType = "seabank_bundle" (jika ke SeaBank) ATAU "bank_to_bank" (jika BSI ke Jago) ATAU "category_pocket" (jika transfer ke kantong keluarga/darurat).

    ATURAN GENERAL CHAT / PERTANYAAN:
    - Jika pesan BUKAN transaksi finansial (misal: "halo", "apa kabar", "gimana cara atur budget makan?"):
      - isFinancial = false, intent = "general_chat", transactions = [].
      - friendlyResponse: Berikan jawaban ramah, natural, dan membantu dalam bahasa Indonesia santai.

    Format output JSON murni tanpa pembungkus markdown (tanpa ```json atau ```):
    {{
      "isFinancial": true,
      "intent": "transaction",
      "transactions": [
        {{
          "type": "expense",
          "amount": 45000,
          "description": "Makan Sate",
          "category": "Makanan & Minuman",
          "merchantName": null
        }},
        {{
          "type": "expense",
          "amount": 35000,
          "description": "Rokok Surya",
          "category": "Rokok & Vape",
          "merchantName": "Indomaret"
        }}
      ],
      "transfer": {{
        "isTransfer": false,
        "transferType": null,
        "amount": 0,
        "fromBank": null,
        "toTarget": null,
        "category": null,
        "notes": null
      }},
      "friendlyResponse": null
    }}
    """

    models_to_try = [
        "gemini-2.0-flash",
        "gemini-1.5-flash",
        "gemini-flash-latest",
        "gemini-1.5-flash-8b",
        "gemini-1.5-pro",
    ]
    last_err = None

    for m_name in models_to_try:
        try:
            logger.info(f"Mencoba AI Chat parsing dengan model: {m_name}")
            model = genai.GenerativeModel(m_name)
            response = model.generate_content(prompt)
            raw_text = response.text.strip()

            clean_json = re.sub(r"^```(?:json)?\s*", "", raw_text, flags=re.MULTILINE)
            clean_json = re.sub(r"\s*```$", "", clean_json, flags=re.MULTILINE).strip()

            data = json.loads(clean_json)
            return data
        except Exception as e:
            logger.warning(f"AI Chat model {m_name} gagal: {e}")
            last_err = e

    raise last_err or Exception("Semua model Gemini gagal memproses teks chat.")


@app.post("/ai/parse-chat", response_model=ChatParseResponse)
def parse_chat(payload: ChatParseRequest):
    if not payload.text or not payload.text.strip():
        return ChatParseResponse(
            isFinancial=False,
            intent="general_chat",
            friendlyResponse="Ada yang bisa saya bantu catat untuk keuangan Anda hari ini?",
            engine="none",
        )

    if not GEMINI_API_KEY:
        raise HTTPException(status_code=400, detail="GEMINI_API_KEY belum disetel pada file .env.")

    try:
        result = parse_chat_with_gemini(payload.text.strip(), payload.senderName or "User")

        transactions = []
        for t in result.get("transactions", []):
            try:
                amt = float(t.get("amount", 0))
                if amt > 0:
                    transactions.append(
                        AITransactionItem(
                            type=t.get("type", "expense"),
                            amount=amt,
                            description=t.get("description", "Pengeluaran"),
                            category=t.get("category", "Makanan & Minuman"),
                            merchantName=t.get("merchantName"),
                        )
                    )
            except Exception as item_err:
                logger.warning(f"Lewati transaksi parsing cacat: {item_err}")

        transfer_data = result.get("transfer")
        transfer_obj = None
        if transfer_data and transfer_data.get("isTransfer"):
            transfer_obj = AITransferInfo(
                isTransfer=True,
                transferType=transfer_data.get("transferType"),
                amount=float(transfer_data.get("amount", 0)),
                fromBank=transfer_data.get("fromBank"),
                toTarget=transfer_data.get("toTarget"),
                category=transfer_data.get("category"),
                notes=transfer_data.get("notes"),
            )

        is_fin = bool(result.get("isFinancial", False) or len(transactions) > 0 or (transfer_obj and transfer_obj.isTransfer))
        intent = result.get("intent", "transaction" if is_fin else "general_chat")

        return ChatParseResponse(
            isFinancial=is_fin,
            intent=intent,
            transactions=transactions,
            transfer=transfer_obj,
            friendlyResponse=result.get("friendlyResponse"),
            engine="gemini",
        )
    except Exception as e:
        logger.error(f"Gagal memproses chat dengan Gemini AI: {e}")
        raise HTTPException(status_code=500, detail=f"Gagal memproses pesan via Gemini AI: {str(e)}")

