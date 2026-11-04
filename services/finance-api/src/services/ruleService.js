'use strict';

/**
 * Aturan kategori pribadi per pengguna.
 *
 * Contoh: user bilang "kalau aku bilang ngopi masuk nongkrong", maka setiap
 * transaksi yang deskripsinya mengandung "ngopi" otomatis masuk kategori itu —
 * mengalahkan tebakan otomatis parser maupun AI.
 */

const prisma = require('../db');
const { matchCategory, DEFAULT_BUDGETS } = require('./budgetService');

function cleanKeyword(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .trim();
}

async function addRule(userNumber, keyword, categoryInput) {
  const kw = cleanKeyword(keyword);
  if (kw.length < 2) {
    return { success: false, error: 'Kata kuncinya terlalu pendek (minimal 2 huruf).' };
  }

  const category = matchCategory(categoryInput);
  if (!category) {
    const list = Object.keys(DEFAULT_BUDGETS).map((c) => `• ${c}`).join('\n');
    return {
      success: false,
      error: `Kategori '${categoryInput}' tidak dikenali.\n\nPilih salah satu:\n${list}`,
    };
  }

  const existing = await prisma.userRule.findFirst({
    where: { userNumber, keyword: { equals: kw, mode: 'insensitive' } },
  });

  if (existing) {
    const rule = await prisma.userRule.update({
      where: { id: existing.id },
      data: { category, isActive: true },
    });
    return { success: true, isNew: false, rule };
  }

  const rule = await prisma.userRule.create({
    data: { userNumber, keyword: kw, category, isActive: true },
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

/**
 * Terapkan aturan pribadi ke daftar item transaksi.
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
  if (rules.length === 0) return items;

  return items.map((item) => {
    const haystack = `${item.description || ''} ${item.merchantName || ''}`.toLowerCase();
    // Kata kunci terpanjang didahulukan supaya "kopi susu" menang atas "kopi".
    const hit = [...rules]
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
      '• `kalau aku bilang ngopi masuk nongkrong`\n' +
      '• `kalau aku bilang galon masuk belanja bulanan`'
    );
  }
  return rules.map((r, i) => `${i + 1}. *${r.keyword}* → ${r.category}`).join('\n');
}

module.exports = {
  addRule,
  listRules,
  removeRule,
  applyRules,
  formatRuleList,
  cleanKeyword,
};