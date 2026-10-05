const OCR_SERVICE_URL = process.env.OCR_SERVICE_URL || 'http://ocr-service:8000';

async function extractReceiptData(imageFilePath) {
  try {
    const res = await fetch(`${OCR_SERVICE_URL}/ocr/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageFilePath }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OCR Service Error (${res.status}): ${errText}`);
    }

    return await res.json();
  } catch (err) {
    console.error('[ocrClient] Gagal memanggil OCR Service:', err.message);
    throw err;
  }
}

module.exports = {
  extractReceiptData,
};
