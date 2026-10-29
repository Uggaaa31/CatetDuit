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

async function parseChatWithAI(text, senderName = 'User') {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(`${OCR_SERVICE_URL}/ai/parse-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, senderName }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[aiClient] AI parse-chat error (${res.status}): ${errText}`);
      return null;
    }

    return await res.json();
  } catch (err) {
    console.warn('[aiClient] Gagal memanggil AI chat parser:', err.message);
    return null;
  }
}

module.exports = {
  extractReceiptData,
  parseChatWithAI,
};

