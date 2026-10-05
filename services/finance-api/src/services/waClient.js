const WHATSAPP_GATEWAY_URL =
  process.env.WHATSAPP_GATEWAY_URL || 'http://whatsapp-gateway:3001';

async function sendWhatsAppMessage(to, text) {
  try {
    const res = await fetch(`${WHATSAPP_GATEWAY_URL}/send-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, text }),
    });
    return await res.json();
  } catch (err) {
    console.error(`[waClient] Gagal mengirim pesan ke ${to}:`, err.message);
    return null;
  }
}

async function sendWhatsAppDocument(to, filePath, fileName, caption = '') {
  try {
    const res = await fetch(`${WHATSAPP_GATEWAY_URL}/send-document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, filePath, fileName, caption }),
    });
    return await res.json();
  } catch (err) {
    console.error(`[waClient] Gagal mengirim dokumen ke ${to}:`, err.message);
    return null;
  }
}

module.exports = {
  sendWhatsAppMessage,
  sendWhatsAppDocument,
};
