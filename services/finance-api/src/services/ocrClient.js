'use strict';

/**
 * Klien untuk service OCR/AI.
 *
 * Membedakan sebab kegagalan supaya webhook bisa bereaksi tepat:
 *   - 429  -> { quotaExceeded: true }  (kuota harian habis)
 *   - 503  -> { unavailable: true }    (semua model AI sedang gagal)
 *   - 400  -> { unavailable: true, reason: 'not_configured' } (API key belum diisi)
 *   - null -> gagal jaringan / timeout (dianggap tidak tersedia)
 */

const OCR_SERVICE_URL = process.env.OCR_SERVICE_URL || 'http://ocr-service:8000';
const AI_TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT_MS || '15000', 10);

async function callService(path, payload, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${OCR_SERVICE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const raw = await res.text();
    let body = null;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch (parseErr) {
        body = { detail: raw.slice(0, 300) };
      }
    }
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function extractReceiptData(imageFilePath) {
  try {
    const { ok, status, body } = await callService('/ocr/extract', { imageFilePath }, AI_TIMEOUT_MS);

    if (!ok) {
      const detail = (body && body.detail) || `HTTP ${status}`;
      const err = new Error(
        status === 429
          ? `Kuota AI habis. ${detail}`
          : status === 503
            ? `AI sedang tidak tersedia. ${detail}`
            : `OCR Service Error (${status}): ${detail}`
      );
      err.status = status;
      throw err;
    }

    return body;
  } catch (err) {
    console.error('[ocrClient] Gagal memanggil OCR Service:', err.message);
    throw err;
  }
}

async function parseChatWithAI(text, senderName = 'User', options = {}) {
  try {
    const payload = { text, senderName };
    if (Array.isArray(options.history) && options.history.length > 0) payload.history = options.history;
    if (options.pending) payload.pending = String(options.pending).slice(0, 800);
    if (options.facts) payload.facts = options.facts;

    const { ok, status, body } = await callService('/ai/parse-chat', payload, AI_TIMEOUT_MS);

    if (!ok) {
      if (status === 429) {
        console.warn('[aiClient] Kuota AI habis (429).');
        return { quotaExceeded: true };
      }
      if (status === 503) {
        console.warn('[aiClient] AI tidak tersedia (503):', (body && body.detail) || '');
        return { unavailable: true };
      }
      if (status === 400) {
        console.warn('[aiClient] AI belum dikonfigurasi (400):', (body && body.detail) || '');
        return { unavailable: true, reason: 'not_configured' };
      }
      console.warn(`[aiClient] AI parse-chat gagal (${status}):`, (body && body.detail) || '');
      return null;
    }

    if (body && body.engine) {
      console.log(`[aiClient] Dijawab oleh ${body.engine} (confidence ${body.confidence ?? '-'})`);
    }
    return body;
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn(`[aiClient] Timeout menunggu AI (>${AI_TIMEOUT_MS} ms).`);
      return { unavailable: true, reason: 'timeout' };
    }
    console.warn('[aiClient] Gagal memanggil AI chat parser:', err.message);
    return { unavailable: true, reason: 'network' };
  }
}

/**
 * Minta AI menulis insight (rekap malam / mingguan) dari data agregat.
 * Mengembalikan { text, engine } atau null kalau AI tidak tersedia.
 */
async function generateInsight(kind, senderName, data) {
  try {
    const { ok, status, body } = await callService(
      '/ai/insight',
      { kind, senderName, data },
      AI_TIMEOUT_MS
    );
    if (!ok) {
      console.warn(`[aiClient] Insight gagal (${status}):`, (body && body.detail) || '');
      return null;
    }
    return body;
  } catch (err) {
    console.warn('[aiClient] Gagal meminta insight AI:', err.message);
    return null;
  }
}

module.exports = {
  extractReceiptData,
  parseChatWithAI,
  generateInsight,
};