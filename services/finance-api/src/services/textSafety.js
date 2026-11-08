'use strict';

/**
 * Pelindung teks keluar (WhatsApp).
 *
 * Emoji 4 byte (di luar BMP) paling rawan rusak: di sebagian klien WhatsApp,
 * jalur salin-tempel, atau terminal, pasangan surrogate-nya terpotong sehingga
 * tampil sebagai "??". Karena itu seluruh balasan bot memakai simbol BMP saja.
 * Fungsi ini adalah jaring pengaman terakhir sebelum teks dikirim:
 *   1. emoji non-BMP yang lolos diganti simbol netral,
 *   2. pasangan surrogate yatim dibuang,
 *   3. variation selector / keycap / zero-width joiner dibuang.
 */
function sanitizeOutgoingText(text) {
  if (text === null || text === undefined) return '';
  let out = String(text);
  out = out.replace(/[\u{10000}-\u{10FFFF}]/gu, '\u25A3');
  out = out.replace(/[\uD800-\uDFFF]/g, '');
  out = out.replace(/[\uFE0F\u20E3\u200D]/g, '');
  out = out.replace(/[ \t]+$/gm, '');   // spasi di ujung baris
  out = out.replace(/\n{3,}/g, '\n\n'); // baris kosong beruntun
  return out.trim();
}

module.exports = { sanitizeOutgoingText };
