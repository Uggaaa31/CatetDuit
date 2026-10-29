'use strict';

/**
 * Konfigurasi identitas pengguna.
 *
 * Semua nomor HP dibaca dari environment (.env) supaya tidak ada data pribadi
 * yang ikut ter-commit ke repository. Nilai default TIDAK di-hardcode di sini;
 * kalau env kosong, sistem akan memberi peringatan dan melewati fitur terkait.
 *
 * Env yang dibaca:
 *   PRIMARY_USER_NUMBER  nomor HP utama pemilik bot (format 62xxx / 08xxx)
 *   BOT_NUMBERS          nomor bot sendiri, dipisah koma (tidak boleh jadi target)
 *   LID_ALIASES          ID @lid lama yang harus dikonsolidasi ke nomor utama
 */

function digitsOnly(value) {
  return String(value == null ? '' : value).replace(/[^0-9]/g, '');
}

function parseNumberList(raw) {
  return String(raw == null ? '' : raw)
    .split(',')
    .map((item) => digitsOnly(item))
    .filter(Boolean);
}

function normalizePhoneNumber(value) {
  if (!value) return '';
  let clean = digitsOnly(value);
  if (clean.startsWith('08')) {
    clean = '62' + clean.slice(1);
  }
  return clean;
}

function isRealPhoneNumber(value) {
  if (!value) return false;
  const clean = digitsOnly(value);
  // Nomor HP reguler Indonesia diawali 62 atau 08, panjang 10-15 digit.
  // WhatsApp LID biasanya 14+ digit tetapi tidak diawali 62/08 (misal 157075..., 22708...)
  return (clean.startsWith('62') || clean.startsWith('08')) && clean.length >= 10 && clean.length <= 15;
}

const BOT_NUMBERS = parseNumberList(process.env.BOT_NUMBERS).map(normalizePhoneNumber);
const LID_ALIASES = parseNumberList(process.env.LID_ALIASES);

let hasWarnedMissingPrimary = false;

/**
 * Nomor HP utama pemilik bot. Kalau PRIMARY_USER_NUMBER tidak diset,
 * jatuh ke nomor HP pertama di ALLOWED_NUMBERS yang bukan nomor bot.
 */
function getPrimaryUserNumber() {
  const explicit = normalizePhoneNumber(process.env.PRIMARY_USER_NUMBER);
  if (explicit) return explicit;

  const fromAllowed = parseNumberList(process.env.ALLOWED_NUMBERS)
    .map(normalizePhoneNumber)
    .filter((n) => isRealPhoneNumber(n) && !BOT_NUMBERS.includes(n));

  if (fromAllowed.length > 0) return fromAllowed[0];

  if (!hasWarnedMissingPrimary) {
    hasWarnedMissingPrimary = true;
    console.warn(
      '[config] PRIMARY_USER_NUMBER / ALLOWED_NUMBERS belum diset. ' +
        'Nomor pengguna utama tidak tersedia, fitur notifikasi akan dilewati.'
    );
  }
  return '';
}

/**
 * Petakan pengirim WhatsApp (nomor HP atau LID) ke nomor HP utama.
 */
function getCanonicalUserNumber(from) {
  const primary = getPrimaryUserNumber();
  if (!from) return primary;

  const clean = digitsOnly(String(from).split('@')[0]);
  if (isRealPhoneNumber(clean)) {
    return normalizePhoneNumber(clean);
  }

  // LID (ID perangkat WhatsApp, bukan nomor HP) tidak bisa dipakai sebagai
  // target kirim pesan, jadi dipetakan ke nomor HP utama.
  return primary;
}

/**
 * Samarkan nomor untuk log supaya tidak menulis nomor penuh ke stdout.
 */
function maskNumber(value) {
  const clean = digitsOnly(value);
  if (clean.length < 7) return clean ? '***' : '';
  return `${clean.slice(0, 4)}****${clean.slice(-3)}`;
}

function logIdentityConfig() {
  console.log(
    `[config] primary=${maskNumber(getPrimaryUserNumber()) || '(kosong)'} ` +
      `bots=[${BOT_NUMBERS.map(maskNumber).join(', ')}] ` +
      `lidAliases=${LID_ALIASES.length}`
  );
}

module.exports = {
  BOT_NUMBERS,
  LID_ALIASES,
  digitsOnly,
  parseNumberList,
  normalizePhoneNumber,
  isRealPhoneNumber,
  getPrimaryUserNumber,
  getCanonicalUserNumber,
  maskNumber,
  logIdentityConfig,
};
