'use strict';

/**
 * Aturan pribadi per pengguna.
 *
 * Dua jenis:
 *   1. kind = 'category' — "kalau aku bilang ngopi masuk nongkrong"
 *      Setiap transaksi yang deskripsinya mengandung "ngopi" otomatis masuk
 *      kantong itu (mengalahkan tebakan parser maupun AI).
 *   2. kind = 'text' — "kalau aku bilang goceng maksudnya 5000"
 *      Alias teks: kata kunci diganti lebih dulu sebelum pesan diurai, sehingga
 *      bisa dipakai untuk nominal ("goceng" -> 5000), merchant ("warung" ->
 *      "di warung bu ida"), maupun singkatan kategori ("brg" -> "bensin").
 */

const prisma = require('../db');
const { matchCategory, DEFAULT_BUDGETS } = require('./budgetService');

const CATEGORY_KIND = 'category';
const TEXT_KIND = 'text';
const MAX_ALIAS_VALUE = 80;

function cleanKeyword(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .trim();
}

function cleanAliasValue(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .trim();
}

/**
 * Tambah / perbarui aturan pribadi.
 * kind = 'category' (default) atau 'text' (alias pengganti).
 */
async function addRule(userNumber, keyword, categoryInput, kind = CATEGORY_KIND) {
  const kw = cleanKeyword(keyword);
  if (kw.length < 2) {
    return { success: false, error: 'Kata kuncinya terlalu pendek (minimal 2 huruf).' };
  }

  const ruleKind = kind === TEXT_KIND ? TEXT_KIND : CATEGORY_KIND;
  let category;

  if (ruleKind === TEXT_KIND) {
    const value = cleanAliasValue(categoryInput);
    if (!value) {
      return { success: false, error: 'Kata penggantinya wajib diisi.' };
    }
    if (value.length > MAX_ALIAS_VALUE) {
      return { success: false, error: `Kata pengganti terlalu panjang (maksimal ${MAX_ALIAS_VALUE} karakter).` };
    }
    if (kw === value.toLowerCase()) {
      return { success: false, error: 'Kata kunci dan penggantinya sama, tidak ada yang berubah.' };
    }
    category = value;
  } else {
    category = matchCategory(categoryInput);
    if (!category) {
      const list = Object.keys(DEFAULT_BUDGETS).map((c) => `• ${c}`).join('\n');
      return {
        success: false,
        error: `Kantong '${categoryInput}' tidak dikenali.\n\nPilih salah satu:\n${list}`,
      };
    }
  }

  const existing = await prisma.userRule.findFirst({
    where: { userNumber, keyword: { equals: kw, mode: 'insensitive' } },
  });

  if (existing) {
    const rule = await prisma.userRule.update({
      where: { id: existing.id },
      data: { category, kind: ruleKind, isActive: true },
    });
    return { success: true, isNew: false, rule };
  }

  const rule = await prisma.userRule.create({
    data: { userNumber, keyword: kw, category, kind: ruleKind, isActive: true },
  });
  return { success: true, isNew: true, rule };
}

async function listRules(userNumber) {
  return await prisma.userRule.findMany({
    where: { userNumber, isActive: true },
    orderBy: { keyword: 'asc' },
  });
}

async function removeRule(userNumber, keyword) {
  const kw = cleanKeyword(keyword);
  if (!kw) return { success: false, error: 'Nama aturan wajib diisi.' };

  const rule = await prisma.userRule.findFirst({
    where: {
      userNumber,
      isActive: true,
      keyword: { equals: kw, mode: 'insensitive' },
    },
  });

  if (!rule) {
    return { success: false, error: `Aturan untuk '${kw}' tidak ditemukan.` };
  }

  const updated = await prisma.userRule.update({
    where: { id: rule.id },
    data: { isActive: false },
  });
  return { success: true, rule: updated };
}

function isTextRule(rule) {
  return Boolean(rule) && rule.kind === TEXT_KIND;
}

function escapeRegExp(value) {
  return String(value || '').replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

/**
 * Ganti semua alias teks pada pesan SEBELUM diurai.
 * Kata kunci terpanjang didahulukan supaya "kopi susu" menang atas "kopi".
 *
 * return { text, applied: [{ keyword, value }] }
 */
async function applyTextAliases(userNumber, text) {
  const raw = String(text || '');
  const hasil = { text: raw, applied: [] };
  if (!raw.trim()) return hasil;

  let rules = [];
  try {
    rules = await listRules(userNumber);
  } catch (err) {
    console.warn('[ruleService] Gagal memuat alias:', err.message);
    return hasil;
  }

  const aliases = rules.filter(isTextRule).sort((a, b) => b.keyword.length - a.keyword.length);
  if (aliases.length === 0) return hasil;

  // Jangan ganggu perintah pengelolaan aturan itu sendiri, mis.
  // "hapus aturan brg" tak boleh berubah jadi "hapus aturan bensin".

  // Jangan ganggu perintah pengelolaan aturan itu sendiri, mis.
  // "hapus aturan brg" tak boleh berubah jadi "hapus aturan bensin".
  if (/\b(?:aturan|alias)\b/i.test(raw)) return hasil;

  let working = raw;
  for (const rule of aliases) {
    const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(rule.keyword)}(?![a-z0-9])`, 'gi');
    if (!pattern.test(working)) continue;
    working = working.replace(pattern, (match, prefix) => `${prefix}${rule.category}`);
    hasil.applied.push({ keyword: rule.keyword, value: rule.category });
  }

  hasil.text = working;
  return hasil;
}

/**
 * Terapkan aturan KANTONG ke daftar item transaksi.
 * Item yang kena aturan diberi tanda `ruleKeyword` supaya bisa disebut di balasan.
 */
async function applyRules(userNumber, items) {
  if (!Array.isArray(items) || items.length === 0) return items;

  let rules = [];
  try {
    rules = await listRules(userNumber);
  } catch (err) {
    console.warn('[ruleService] Gagal memuat aturan:', err.message);
    return items;
  }

  const categoryRules = rules.filter((r) => !isTextRule(r));
  if (categoryRules.length === 0) return items;

  return items.map((item) => {
    const haystack = `${item.description || ''} ${item.merchantName || ''}`.toLowerCase();
    // Kata kunci terpanjang didahulukan supaya "kopi susu" menang atas "kopi".
    const hit = [...categoryRules]
      .sort((a, b) => b.keyword.length - a.keyword.length)
      .find((rule) => haystack.includes(rule.keyword.toLowerCase()));

    if (!hit) return item;
    return { ...item, category: hit.category, ruleKeyword: hit.keyword };
  });
}

function formatRuleList(rules) {
  if (!rules || rules.length === 0) {
    return (
      'Belum ada aturan pribadi.\n\n' +
      'Contoh membuatnya:\n' +
      '• `kalau aku bilang ngopi masuk nongkrong` (kata kunci -> kantong)\n' +
      '• `kalau aku bilang goceng maksudnya 5000` (alias nominal)\n' +
      '• `kalau aku bilang brg maksudnya bensin` (alias singkatan)\n' +
      '• `kalau aku bilang warung maksudnya di warung bu ida` (alias merchant)'
    );
  }

  const kategori = rules.filter((r) => !isTextRule(r));
  const alias = rules.filter(isTextRule);

  let out = '';
  if (kategori.length > 0) {
    out += '*Aturan Kantong:*\n' + kategori.map((r) => `• *${r.keyword}* → ${r.category}`).join('\n');
  }
  if (alias.length > 0) {
    if (out) out += '\n\n';
    out += '*Alias Kata:*\n' + alias.map((r) => `• *${r.keyword}* → ${r.category}`).join('\n');
  }
  return out;
}

module.exports = {
  addRule,
  listRules,
  removeRule,
  applyRules,
  applyTextAliases,
  formatRuleList,
  cleanKeyword,
  CATEGORY_KIND,
  TEXT_KIND,
};
