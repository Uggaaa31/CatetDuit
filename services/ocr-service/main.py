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
      "date": "DD/MM/YYYY",
      "category": "Makanan & Minuman | Bensin & Transportasi | Kuota & Internet | Listrik, Air & Wifi | Belanja Bulanan | Nongkrong & Hiburan | Kirim Keluarga | Rokok & Vape | Dana Darurat | Tabungan | Lain-lain",
      "items": [
        {"name": "nama item jika struk belanja", "price": 15000, "qty": 1}
      ]
    }

    Panduan penting:
    - totalAmount harus berupa angka desimal murni tanpa titik atau simbol Rp (contoh: 94500 atau 150000). Jika ada biaya admin, gunakan total nominal yang terpotong.
    - transactionType: jika transfer keluar / pembayaran / debit -> "expense". Jika bukti transfer masuk / dana diterima / kredit -> "income".
    - Jika ini resi M-Banking / Transfer:
      * Transfer ke orang tua / keluarga / saudara -> 'Kirim Keluarga'
      * Bayar tagihan PLN / listrik / PDAM / air / Wifi / Indihome -> 'Listrik, Air & Wifi'
      * Bayar pulsa / paket data -> 'Kuota & Internet'
      * Pembayaran QRIS restoran / warung makan / cafe / kopi -> 'Nongkrong & Hiburan' atau 'Makanan & Minuman'
      * Pembayaran di SPBU Pertamina -> 'Bensin & Transportasi'
      * Transfer ke rekening tabungan / deposito / investasi -> 'Tabungan'
      * Jika tidak ada keterangan spesifik -> 'Lain-lain' atau 'Belanja Bulanan'
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
