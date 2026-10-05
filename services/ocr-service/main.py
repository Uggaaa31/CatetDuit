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

app = FastAPI(title="AI Receipt Extraction Service")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
    logger.info("Gemini AI Vision terkonfigurasi untuk OCR struk.")
else:
    logger.warning("GEMINI_API_KEY belum disetel pada file .env.")

class ReceiptItem(BaseModel):
    name: str
    price: float
    qty: Optional[int] = 1

class OCRRequest(BaseModel):
    imageFilePath: str

class OCRResponse(BaseModel):
    merchantName: Optional[str] = "Toko / Merchant"
    totalAmount: float
    date: Optional[str] = None
    category: Optional[str] = "Belanja Bulanan"
    items: List[ReceiptItem] = []
    engine: str = "gemini"


def extract_with_gemini(image_path: str) -> dict:
    img = Image.open(image_path)
    img = ImageOps.exif_transpose(img)

    prompt = """
    Kamu adalah asisten analisis struk belanja di Indonesia.
    Analisis gambar struk belanja berikut dengan teliti.
    Ekstrak data dan berikan HANYA format JSON valid tanpa tanda markdown (tanpa ```json atau ```):
    {
      "merchantName": "nama toko atau merchant (contoh: Indomaret, Alfamart, KFC, TOP MODE, dsb)",
      "totalAmount": 45000,
      "date": "DD/MM/YYYY",
      "category": "Makanan & Minuman | Rokok & Vape | Belanja Bulanan | Bensin & Transportasi | Tagihan & Utilitas | Nongkrong & Hiburan | Lain-lain",
      "items": [
        {"name": "nama item", "price": 15000, "qty": 1}
      ]
    }
    Catatan penting:
    - totalAmount harus berupa angka desimal murni tanpa simbol Rp atau titik (contoh: 94500).
    - Jika ada rokok/vape, kategorikan ke 'Rokok & Vape'.
    - Pastikan semua item barang pada struk dimasukkan ke dalam array items.
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
            merchantName=result.get("merchantName", "Struk Belanja"),
            totalAmount=float(result.get("totalAmount", 0)),
            date=result.get("date"),
            category=result.get("category", "Belanja Bulanan"),
            items=[ReceiptItem(**i) for i in result.get("items", [])],
            engine="gemini"
        )
    except Exception as e:
        logger.error(f"Gagal memproses struk dengan Gemini AI: {e}")
        raise HTTPException(status_code=500, detail=f"Gagal memproses gambar struk: {str(e)}")
