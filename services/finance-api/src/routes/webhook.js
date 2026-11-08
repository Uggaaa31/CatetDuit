const express = require('express');
const router = express.Router();
const prisma = require('../db');
const { parseMessage, isConversationalText, detectCategory, countNominals } = require('../services/nlpParser');
const { sendWhatsAppMessage, sendWhatsAppDocument } = require('../services/waClient');
const { extractReceiptData, parseChatWithAI } = require('../services/ocrClient');
const { generateFinancialExcel } = require('../services/excelService');
const {
  checkBudgetStatus,
  generateBudgetReport,
  generateTodayBudgetReport,
  updateCategoryBudget,
  syncDefaultBudgets,
  transferPocketBudget,
  getPayCycleRange,
  getDualCycleGuide,
  matchCategory,
  DEFAULT_BUDGETS,
} = require('../services/budgetService');
const {
  executeSalary21,
  executeBooster1,
  executeNightlyReminder,
  executeAllocationReminder22,
  executeWeeklyInsight,
} = require('../services/schedulerService');
const {
  addBill,
  listBills,
  removeBill,
  payBill,
  generateBillReport,
} = require('../services/billService');
const {
  addDebt,
  settleDebt,
  listDebts,
  generateDebtReport,
} = require('../services/debtService');
const crypto = require('crypto');
const dayjs = require('dayjs');
const {
  saveMessage,
  getRecentHistory,
  setPending,
  takePending,
  hasPendingClarification,
} = require('../services/chatMemory');
const { buildFacts } = require('../services/financeFacts');
const { addRule, listRules, removeRule, applyRules, formatRuleList } = require('../services/ruleService');

// Map untuk konfirmasi 2 langkah perintah berbahaya (TTL 60 detik)
const pendingRestarts = new Map();

function formatRupiah(number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(number);
}

function parseSearchQuery(query) {
  let text = query.trim().toLowerCase();

  const months = {
    januari: 0, jan: 0,
    februari: 1, feb: 1,
    maret: 2, mar: 2,
    april: 3, apr: 3,
    mei: 4,
    juni: 5, jun: 5,
    juli: 6, jul: 6,
    agustus: 7, ags: 7, agt: 7,
    september: 8, sep: 8, sept: 8,
    oktober: 9, okt: 9,
    november: 10, nov: 10,
    desember: 11, des: 11,
  };

  let targetMonth = null;
  let targetYear = dayjs().year();

  for (const [mName, mIdx] of Object.entries(months)) {
    const mRegex = new RegExp(`(?:^|[^a-z])${mName}(?:[^a-z]|$)`, 'i');
    if (mRegex.test(text)) {
      targetMonth = mIdx;
      if (targetMonth > dayjs().month()) {
        targetYear = dayjs().year() - 1;
      }
      text = text.replace(mRegex, ' ').trim();
      break;
    }
  }

  const categoryAliases = {
    'makanan & minuman': 'Makanan & Minuman',
    'makanan dan minuman': 'Makanan & Minuman',
    'makan': 'Makanan & Minuman',
    'rokok & vape': 'Rokok & Vape',
    'rokok dan vape': 'Rokok & Vape',
    'bensin & transportasi': 'Bensin & Transportasi',
    'bensin dan transportasi': 'Bensin & Transportasi',
    'kuota & internet': 'Kuota & Internet',
    'kuota dan internet': 'Kuota & Internet',
    'listrik, air & wifi': 'Listrik, Air & Wifi',
    'listrik air wifi': 'Listrik, Air & Wifi',
    'listrik dan air': 'Listrik, Air & Wifi',
    'belanja bulanan': 'Belanja Bulanan',
    'belanja': 'Belanja Bulanan',
    'kirim keluarga': 'Kirim Keluarga',
    'dana darurat': 'Dana Darurat',
    'tabungan': 'Tabungan',
    'nongkrong & hiburan': 'Nongkrong & Hiburan',
    'nongkrong dan hiburan': 'Nongkrong & Hiburan',
  };

  let detectedOldCat = null;
  for (const [alias, realCat] of Object.entries(categoryAliases)) {
    const escaped = alias.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
    const cRegex = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, 'i');
    if (cRegex.test(text)) {
      detectedOldCat = realCat;
      text = text.replace(cRegex, ' ').trim();
      break;
    }
  }

  text = text.replace(/(?:^|[^a-z0-9])(transaksi|catatan|pos|pada|di|bulan|yang|untuk|uang)(?:[^a-z0-9]|$)/gi, ' ').trim();
  text = text.replace(/\s{2,}/g, ' ').trim();

  let startDate = null;
  let endDate = null;
  if (targetMonth !== null) {
    startDate = dayjs().year(targetYear).month(targetMonth).startOf('month').toDate();
    endDate = dayjs().year(targetYear).month(targetMonth).endOf('month').toDate();
  }

  return {
    original: query,
    targetMonth,
    targetYear,
    startDate,
    endDate,
    detectedOldCat,
    keyword: text || null,
  };
}

function getPeriodRange(period) {
  const now = dayjs();
  let start;
  let end = now.endOf('day');
  let label;

  if (period === 'month') {
    // Gunakan siklus gajian Tgl 21 s/d Tgl 20 bulan berikutnya
    const cycle = getPayCycleRange(now);
    start = cycle.start;
    end = cycle.end;
    label = cycle.label;
  } else if (period === 'week') {
    start = now.startOf('week').toDate();
    label = 'Minggu Ini';
  } else if (period === 'yesterday') {
    start = now.subtract(1, 'day').startOf('day').toDate();
    end = now.subtract(1, 'day').endOf('day').toDate();
    label = `Kemarin (${now.subtract(1, 'day').format('DD/MM/YYYY')})`;
  } else {
    start = now.startOf('day').toDate();
    label = `Hari Ini (${now.format('DD/MM/YYYY')})`;
  }

  return {
    start,
    end,
    label,
  };
}

const { getCanonicalUserNumber, isSenderAllowed } = require('../config');

// Aturan izin pengirim dipusatkan di config.js (isSenderAllowed) supaya
// konsisten dan bisa diuji langsung.
function isAllowedSender(from) {
  return isSenderAllowed(from);
}

async function executePocketShiftOperation(userNumber, from, shiftData) {
  const { amount, fromPocket, toPocket } = shiftData;

  const result = await transferPocketBudget(userNumber, fromPocket, toPocket, amount);
  if (!result.success) {
    return await sendWhatsAppMessage(from, `⚠️ Gagal menggeser anggaran: ${result.error}`);
  }

  const reply =
    `🔄 *Pergeseran Anggaran Antar Kantong Berhasil!*\n\n` +
    `💰 *Nominal Dipindahkan:* ${formatRupiah(result.amount)}\n\n` +
    `📤 *Kantong Asal:* ${result.fromCategory}\n` +
    `   └ Limit: ${formatRupiah(result.oldFromLimit)} ➔ *${formatRupiah(result.newFromLimit)}*\n` +
    `   └ Sisa kuota: ${formatRupiah(result.fromRemaining)}\n\n` +
    `📥 *Kantong Tujuan:* ${result.toCategory}\n` +
    `   └ Limit: ${formatRupiah(result.oldToLimit)} ➔ *${formatRupiah(result.newToLimit)}*\n` +
    `   └ Sisa kuota: ${formatRupiah(result.toRemaining)}\n` +
    (result.toCategory === 'Makanan & Minuman' && result.toDailyAllowance > 0
      ? `   └ Jatah harian baru: *${formatRupiah(result.toDailyAllowance)}/hari* (sisa ${result.daysRemaining} hari)\n\n`
      : '\n') +
    `✅ Anggaran berhasil dipindahkan ke kantong ${result.toCategory}!\n` +
    `_Ketik *budget* untuk melihat seluruh status kuota kantong._`;

  return await sendWhatsAppMessage(from, reply);
}

async function executeTransferOperation(userNumber, from, transferData) {
  const { amount, fromBank, toTarget, category, transferType } = transferData;
  const numAmount = parseFloat(amount) || 0;

  // Kasus A: Alokasi Bundle ke SeaBank Rp 800.000 (Dana Darurat 500k + Tabungan 300k)
  if (transferType === 'seabank_bundle' && (numAmount === 800000 || numAmount === 0)) {
    const finalAmount = numAmount || 800000;
    await prisma.transaction.create({
      data: {
        userNumber,
        type: 'expense',
        source: 'transfer_seabank',
        amount: 500000,
        description: 'Alokasi Dana Darurat (SeaBank)',
        category: 'Dana Darurat',
      },
    });

    await prisma.transaction.create({
      data: {
        userNumber,
        type: 'expense',
        source: 'transfer_seabank',
        amount: 300000,
        description: 'Alokasi Tabungan & Investasi (SeaBank)',
        category: 'Tabungan',
      },
    });

    const reply =
      `🔄 *Alokasi ke SeaBank Berhasil Dicatat!*\n\n` +
      `🏦 *Tujuan:* SeaBank (Uang Dingin Berbunga Harian)\n` +
      `💰 *Total Transfer:* ${formatRupiah(finalAmount)}\n\n` +
      `📋 *Rincian Alokasi Kantong:*\n` +
      `• 🛡️ *Dana Darurat:* Rp 500.000 (Terkunci aman di SeaBank)\n` +
      `• 🔒 *Tabungan & Investasi:* Rp 300.000 (Aset bertumbuh)\n\n` +
      `✅ Dana berhasil diamankan dari godaan belanja harian!\n` +
      `_Ketik 'budget' untuk melihat status kuota tabungan Anda._`;

    return await sendWhatsAppMessage(from, reply);
  }

  // Kasus B: Pemindahan Saldo Operasional Antar Bank (misal BSI ke Bank Jago)
  if (transferType === 'bank_to_bank' || (toTarget && toTarget.toLowerCase().includes('jago'))) {
    const reply =
      `🔄 *Pemindahan Saldo Antar Bank Berhasil Dicatat!*\n\n` +
      `🏦 *Dari Rekening:* ${fromBank || 'BSI'}\n` +
      `🎯 *Ke Rekening:* ${toTarget || 'Bank Jago'}\n` +
      `💰 *Nominal:* ${formatRupiah(numAmount)}\n\n` +
      `✅ Uang operasional siap dialokasikan ke Kantong-Kantong Jago (Makan, Tagihan, Sembako, Ortu, Rokok).\n` +
      `_Catatan: Pemindahan saldo antar bank ini tidak memotong kuota belanja harian._`;

    return await sendWhatsAppMessage(from, reply);
  }

  // Kasus D: Transfer ke orang/toko yang tidak menyebut bank maupun kantong.
  // Tetap dicatat sebagai pengeluaran supaya uang keluar tidak hilang dari pembukuan.
  if (transferType === 'person_transfer') {
    const person = toTarget || 'Penerima';
    const category = detectCategory(`transfer ke ${person}`, 'expense', numAmount);

    const tx = await prisma.transaction.create({
      data: {
        userNumber,
        type: 'expense',
        source: 'transfer_person',
        amount: numAmount,
        description: `Transfer ke ${person}`,
        category,
      },
    });

    const budgetStatus = await checkBudgetStatus(userNumber, tx.category);
    const budgetNote = budgetStatus.hasBudget
      ? `\n📊 *Sisa kuota ${tx.category}:* ${formatRupiah(budgetStatus.remaining)}`
      : '';

    const reply =
      `✅ *Transfer Berhasil Dicatat!*\n\n` +
      `👤 *Tujuan:* ${person}\n` +
      `💰 *Nominal:* ${formatRupiah(tx.amount)}\n` +
      `🏷️ *Kategori:* ${tx.category}` +
      budgetNote +
      `\n\n_Kategori diisi otomatis. Kalau keliru, ketik *ubah kategori [nama]*. Ketik *batal* untuk membatalkan._`;

    return await sendWhatsAppMessage(from, reply);
  }

  // Kasus C: Alokasi ke Kantong Tertentu (Ortu, Dana Darurat, Tabungan, Makan, dll)
  const targetCategory = category || 'Belanja Bulanan';
  await prisma.transaction.create({
    data: {
      userNumber,
      type: 'expense',
      source: 'transfer_pocket',
      amount: numAmount,
      description: `Alokasi / Transfer ke ${toTarget || targetCategory}`,
      category: targetCategory,
    },
  });

  const budgetStatus = await checkBudgetStatus(userNumber, targetCategory);
  let budgetNote = '';
  if (budgetStatus.hasBudget) {
    budgetNote = `\n📊 *Status Kantong ${targetCategory}:* Terpakai ${formatRupiah(budgetStatus.totalSpent)} / ${formatRupiah(budgetStatus.monthlyLimit)}`;
  }

  const reply =
    `✅ *Alokasi ke Kantong Berhasil Dicatat!*\n\n` +
    `🎯 *Tujuan:* ${toTarget || targetCategory}\n` +
    `💰 *Nominal:* ${formatRupiah(numAmount)}\n` +
    `🏷️ *Kategori:* ${targetCategory}\n` +
    budgetNote +
    `\n\n_Ketik 'budget' untuk melihat sisa seluruh kuota anggaran._`;

  return await sendWhatsAppMessage(from, reply);
}

async function executeTransactionsOperation(userNumber, from, items, sourceLabel = 'manual', badgeText = '') {
  if (!items || items.length === 0) return;

  // Aturan kategori pribadi menang atas tebakan otomatis parser maupun AI.
  items = await applyRules(userNumber, items);

  if (items.length === 1) {
    const { type, amount, description, category, merchantName, customDate } = items[0];

    const txData = {
      userNumber,
      type: type || 'expense',
      amount: parseFloat(amount) || 0,
      description: description || 'Pengeluaran',
      category: matchCategory(category) || category || 'Makanan & Minuman',
      merchantName: merchantName || null,
      source: sourceLabel || 'manual',
    };
    if (customDate) {
      txData.createdAt = customDate;
    }

    const tx = await prisma.transaction.create({
      data: txData,
    });

    const icon = tx.type === 'income' ? '💰' : '💸';
    const label = tx.type === 'income' ? 'Pemasukan' : 'Pengeluaran';

    let reply =
      `✅ *${label} Berhasil Dicatat!*\n\n` +
      `${icon} *Nominal:* ${formatRupiah(tx.amount)}\n` +
      `🏷️ *Kategori:* ${tx.category}\n` +
      `📦 *Barang/Catatan:* ${tx.description}\n`;

    if (items[0].ruleKeyword) {
      reply += `⚙️ *Aturan pribadi:* "${items[0].ruleKeyword}" → ${tx.category}\n`;
    }

    if (customDate) {
      reply += `📅 *Tanggal Transaksi:* ${dayjs(tx.createdAt).format('DD/MM/YYYY')}\n`;
    }

    if (tx.merchantName) {
      reply += `🏪 *Toko/Merchant:* ${tx.merchantName}\n`;
    }

    if (tx.type === 'expense') {
      const budgetStatus = await checkBudgetStatus(userNumber, tx.category);
      if (budgetStatus.hasBudget) {
        if (budgetStatus.isOverbudget) {
          reply += `\n🚨 *PERINGATAN OVERBUDGET:* Pengeluaran '${tx.category}' sudah MELEBIHI batas siklus! (Terpakai: ${formatRupiah(budgetStatus.totalSpent)} / Limit: ${formatRupiah(budgetStatus.monthlyLimit)})`;
        } else if (budgetStatus.isDailyCategory || budgetStatus.todayDailyLimit > 0) {
          if (budgetStatus.isTodayOver) {
            reply += `\n⚠️ *Batas Hari Ini (${tx.category}):* Terpakai ${formatRupiah(budgetStatus.todaySpent)} / Jatah ${formatRupiah(budgetStatus.todayDailyLimit)} (Over ${formatRupiah(Math.abs(budgetStatus.todayDailyRemaining))} hari ini. Jatah esok: ${formatRupiah(budgetStatus.nextDayAllowance)}/hari)`;
          } else {
            reply += `\n💡 *Batas Hari Ini (${tx.category}):* Jatah ${formatRupiah(budgetStatus.todayDailyLimit)} | Keluar ${formatRupiah(budgetStatus.todaySpent)} | Sisa ${formatRupiah(budgetStatus.todayDailyRemaining)}\n   _(Sisa kuota siklus: ${formatRupiah(budgetStatus.remaining)}, sisa ${budgetStatus.daysRemaining} hari lagi)_`;
          }
        } else if (budgetStatus.isWarning) {
          reply += `\n⚠️ *Perhatian:* Pengeluaran '${tx.category}' sudah mencapai ${budgetStatus.percentage}% dari budget siklus ini (Sisa: ${formatRupiah(budgetStatus.remaining)})`;
        } else {
          reply += `\n📊 *Sisa kuota ${tx.category}:* ${formatRupiah(budgetStatus.remaining)} dari limit ${formatRupiah(budgetStatus.monthlyLimit)}`;
        }
      }
    }

    if (badgeText) {
      reply += `\n\n${badgeText}`;
    }

    reply += `\n\n_Ketik *ubah nominal [angka]*, *ubah kategori [nama]*, atau *batal* jika keliru._`;
    return await sendWhatsAppMessage(from, reply);
  }

  // Multi-item
  let totalExpense = 0;
  let totalIncome = 0;
  const createdTxs = [];
  // Satu pesan = satu batchId, dipakai fitur "batal" agar pembatalan tepat sasaran.
  const batchId = crypto.randomUUID();

  for (const item of items) {
    const txData = {
      userNumber,
      type: item.type || 'expense',
      amount: parseFloat(item.amount) || 0,
      description: item.description || 'Pengeluaran',
      category: matchCategory(item.category) || item.category || 'Makanan & Minuman',
      merchantName: item.merchantName || null,
      source: sourceLabel || 'manual_multi',
      batchId,
    };
    if (item.customDate) {
      txData.createdAt = item.customDate;
    }
    const tx = await prisma.transaction.create({
      data: txData,
    });
    createdTxs.push(tx);
    if (item.type === 'income') totalIncome += tx.amount;
    else totalExpense += tx.amount;
  }

  let itemListText = '';
  createdTxs.forEach((tx, idx) => {
    const icon = tx.type === 'income' ? '💰' : '💸';
    const merch = tx.merchantName ? ` (@${tx.merchantName})` : '';
    itemListText += `${idx + 1}. ${icon} *${tx.description}*${merch}\n   └ 🏷️ ${tx.category} — ${formatRupiah(tx.amount)}\n`;
  });

  let summaryText = '';
  if (totalExpense > 0 && totalIncome > 0) {
    summaryText = `💸 *Total Pengeluaran:* ${formatRupiah(totalExpense)}\n💰 *Total Pemasukan:* ${formatRupiah(totalIncome)}`;
  } else if (totalIncome > 0) {
    summaryText = `💰 *Total Pemasukan:* ${formatRupiah(totalIncome)}`;
  } else {
    summaryText = `💸 *Total Pengeluaran:* ${formatRupiah(totalExpense)}`;
  }

  let budgetAlerts = [];
  const expenseCats = [...new Set(createdTxs.filter((t) => t.type === 'expense').map((t) => t.category))];
  for (const cat of expenseCats) {
    const budgetStatus = await checkBudgetStatus(userNumber, cat);
    if (budgetStatus.hasBudget) {
      if (budgetStatus.isOverbudget) {
        budgetAlerts.push(`🚨 *${cat}* MELEBIHI batas siklus! (Sisa: ${formatRupiah(budgetStatus.remaining)})`);
      } else if (budgetStatus.isDailyCategory || budgetStatus.todayDailyLimit > 0) {
        if (budgetStatus.isTodayOver) {
          budgetAlerts.push(`⚠️ *Batas Hari Ini (${cat}):* Terpakai ${formatRupiah(budgetStatus.todaySpent)} / Jatah ${formatRupiah(budgetStatus.todayDailyLimit)} (Over ${formatRupiah(Math.abs(budgetStatus.todayDailyRemaining))})`);
        } else {
          budgetAlerts.push(`💡 *Batas Hari Ini (${cat}):* Sisa ${formatRupiah(budgetStatus.todayDailyRemaining)} (Keluar ${formatRupiah(budgetStatus.todaySpent)} / Jatah ${formatRupiah(budgetStatus.todayDailyLimit)})`);
        }
      } else if (budgetStatus.isWarning) {
        budgetAlerts.push(`⚠️ *${cat}* sudah ${budgetStatus.percentage}% siklus (Sisa: ${formatRupiah(budgetStatus.remaining)})`);
      }
    }
  }

  const appliedRules = items
    .map((item, idx) => (item.ruleKeyword ? `"${item.ruleKeyword}" → ${createdTxs[idx] ? createdTxs[idx].category : item.category}` : null))
    .filter(Boolean);
  const ruleBlock = appliedRules.length > 0 ? `\n⚙️ *Aturan pribadi dipakai:* ${appliedRules.join(', ')}\n` : '';

  const alertBlock = budgetAlerts.length > 0 ? `\n${budgetAlerts.join('\n')}\n` : '';
  const badgeBlock = badgeText ? `\n${badgeText}\n` : '';

  const reply =
    `✅ *${createdTxs.length} Transaksi Berhasil Dicatat Sekaligus!*\n\n` +
    itemListText +
    `═══════════════════════\n` +
    summaryText + '\n' +
    ruleBlock +
    alertBlock +
    badgeBlock +
    `\n_Ketik *batal* untuk membatalkan semua catatan ini sekaligus, atau *budget* untuk cek sisa kuota._`;

  return await sendWhatsAppMessage(from, reply);
}

// ---------------------------------------------------------------------------
// Gerbang pemakaian AI: kill switch (AI_ENABLED) + batas pemakaian per pengguna
// ---------------------------------------------------------------------------
const AI_ENABLED = String(process.env.AI_ENABLED || 'true').trim().toLowerCase() !== 'false';
const AI_RATE_LIMIT_PER_HOUR = parseInt(process.env.AI_RATE_LIMIT_PER_HOUR || '30', 10);
const aiUsage = new Map(); // userNumber -> [timestamp]
const aiNoticeAt = new Map(); // userNumber -> timestamp notifikasi terakhir

function aiGate(userNumber) {
  if (!AI_ENABLED) return { allowed: false, reason: 'disabled' };
  if (!(AI_RATE_LIMIT_PER_HOUR > 0)) return { allowed: true };

  const now = Date.now();
  const windowStart = now - 60 * 60 * 1000;
  const hits = (aiUsage.get(userNumber) || []).filter((t) => t > windowStart);

  if (hits.length >= AI_RATE_LIMIT_PER_HOUR) {
    aiUsage.set(userNumber, hits);
    return { allowed: false, reason: 'limited' };
  }

  hits.push(now);
  aiUsage.set(userNumber, hits);
  return { allowed: true };
}

/**
 * Beri tahu pengguna maksimal sekali per 30 menit untuk masalah AI yang sama,
 * supaya tidak jadi spam saat kuota habis atau server AI sedang down.
 */
async function notifyAiIssue(from, userNumber, text) {
  const now = Date.now();
  if (now - (aiNoticeAt.get(userNumber) || 0) < 30 * 60 * 1000) return;
  aiNoticeAt.set(userNumber, now);
  await sendWhatsAppMessage(from, text);
}

/**
 * Kirim pesan ke AI lalu eksekusi hasilnya.
 * true  = pesan sudah ditangani (hentikan rantai handler)
 * false = lanjut ke parser regex / balasan default
 */
const AI_DUPLICATE_WINDOW_MS = parseInt(process.env.AI_DUPLICATE_WINDOW_MS || '180000', 10);

/**
 * Saring transaksi hasil AI yang sebenarnya sudah tercatat beberapa menit terakhir.
 * Jaring pengaman kalau AI "lupa" bahwa transaksi itu sudah masuk pembukuan.
 */
async function filterDuplicateTransactions(userNumber, items) {
  if (!Array.isArray(items) || items.length === 0) return items;

  try {
    const since = new Date(Date.now() - AI_DUPLICATE_WINDOW_MS);
    const recent = await prisma.transaction.findMany({
      where: { userNumber, createdAt: { gte: since } },
    });
    const seen = new Set(
      recent.map((t) => `${Math.round(t.amount)}|${String(t.description || '').trim().toLowerCase()}`)
    );

    return items.filter((item) => {
      const key = `${Math.round(Number(item.amount) || 0)}|${String(item.description || '').trim().toLowerCase()}`;
      return !seen.has(key);
    });
  } catch (err) {
    console.warn('[webhook] Gagal memeriksa duplikat transaksi:', err.message);
    return items;
  }
}

/**
 * Apakah hasil parser regex sudah lengkap dan aman dicatat langsung?
 *
 * Aturannya: jumlah transaksi yang terbaca >= jumlah nominal yang disebut.
 * Kalau nominal lebih banyak dari transaksi (mis. "sate 45rb terus rokok 35rb"),
 * berarti ada yang belum tertangkap -> serahkan ke AI.
 */
function isConfidentParse(parsed, text) {
  if (!parsed) return false;
  if (parsed.isPocketShift && parsed.data) return true;
  if (parsed.isTransfer && parsed.data) return true;

  if (parsed.isTransaction && Array.isArray(parsed.items) && parsed.items.length > 0) {
    const nominalCount = countNominals(text);
    return nominalCount > 0 && parsed.items.length >= nominalCount;
  }
  return false;
}

const ANALYSIS_HINTS = [
  'berapa', 'paling', 'boros', 'hemat', 'total', 'sisa', 'budget', 'anggaran',
  'banding', 'naik', 'turun', 'bulan ini', 'minggu ini', 'hari ini', 'jatah',
  'rekap', 'laporan', 'vs', 'sampai',
];

function looksLikeAnalysisQuestion(text) {
  const t = String(text || '').toLowerCase();
  return t.includes('?') || ANALYSIS_HINTS.some((hint) => t.includes(hint));
}

/**
 * Kirim pesan ke AI lalu eksekusi hasilnya.
 * true  = pesan sudah ditangani (hentikan rantai handler)
 * false = lanjut ke parser regex / balasan default
 */
async function runAiBranch(userNumber, from, text, senderName) {
  const gate = aiGate(userNumber);
  if (!gate.allowed) {
    if (gate.reason === 'limited') {
      await notifyAiIssue(
        from,
        userNumber,
        '⏳ _Mode hemat aktif: asisten AI diliburkan sementara karena terlalu banyak permintaan. Pesan transaksi tetap saya proses seperti biasa._'
      );
    }
    return false;
  }

  // Pesan user sudah disimpan oleh route; ambil konteks yang relevan.
  const pending = await takePending(userNumber);
  const history = await getRecentHistory(userNumber);

  let facts = null;
  if (looksLikeAnalysisQuestion(text)) {
    try {
      facts = await buildFacts(userNumber);
    } catch (factsErr) {
      console.warn('[webhook] Gagal menyiapkan data keuangan untuk AI:', factsErr.message);
    }
  }

  const aiResult = await parseChatWithAI(text, senderName, {
    history,
    pending: pending ? pending.question : null,
    facts,
  });

  if (!aiResult) return false;

  if (aiResult.quotaExceeded) {
    await notifyAiIssue(
      from,
      userNumber,
      '⚠️ _Kuota AI sedang habis. Pesan transaksi tetap saya proses dengan mode cepat (tanpa AI), tapi obrolan bebas belum bisa dilayani._'
    );
    return false;
  }

  if (aiResult.unavailable) {
    await notifyAiIssue(
      from,
      userNumber,
      '⚠️ _Asisten AI sedang tidak tersedia. Pesan Anda tetap saya proses dengan mode cepat (tanpa AI)._\n_Cek status: buka /health pada service OCR._'
    );
    return false;
  }

  let handled = false;

  // A. Transaksi keuangan hasil ekstraksi AI
  if (aiResult.isFinancial && Array.isArray(aiResult.transactions) && aiResult.transactions.length > 0) {
    const freshItems = await filterDuplicateTransactions(userNumber, aiResult.transactions);

    if (freshItems.length === 0) {
      // Semua sudah tercatat barusan -> jangan dobel, cukup jawab.
      const msg =
        aiResult.friendlyResponse ||
        'Catatan itu sudah masuk pembukuan barusan, jadi tidak saya catat dua kali ya.';
      await sendWhatsAppMessage(from, msg);
      await saveMessage(userNumber, 'assistant', msg);
      return true;
    }

    await executeTransactionsOperation(
      userNumber,
      from,
      freshItems,
      'gemini_chat',
      '🤖 _(Dianalisis & dicatat otomatis oleh Gemini AI)_'
    );
    handled = true;
  } else if (aiResult.isFinancial && aiResult.transfer && aiResult.transfer.isTransfer) {
    // B. Pemindahan saldo / transfer
    await executeTransferOperation(userNumber, from, aiResult.transfer);
    handled = true;
  } else if (aiResult.isFinancial && aiResult.pocketShift && aiResult.pocketShift.isShift) {
    // B1. Pergeseran anggaran antar kantong
    await executePocketShiftOperation(userNumber, from, aiResult.pocketShift);
    handled = true;
  } else if (aiResult.friendlyResponse) {
    // C. Jawaban ramah / pertanyaan / permintaan klarifikasi
    await sendWhatsAppMessage(from, aiResult.friendlyResponse);
    handled = true;
  }

  // Simpan pertanyaan klarifikasi supaya jawaban pendek berikutnya nyambung.
  const needsClarification =
    aiResult.needsClarification || (!handled && Number(aiResult.confidence) < 0.6);
  if (needsClarification) {
    await setPending(userNumber, aiResult.friendlyResponse || 'Boleh diperjelas nominalnya?', {
      pesan_sebelumnya: text,
      pertanyaan: aiResult.friendlyResponse || null,
      confidence: aiResult.confidence,
      kategori_rabaan: (aiResult.transactions || []).map((t) => ({
        amount: t.amount,
        description: t.description,
        category: t.category,
      })),
    });
  }

  // Catat balasan asisten ke memori (untuk konteks pesan berikutnya).
  if (aiResult.friendlyResponse) {
    await saveMessage(userNumber, 'assistant', aiResult.friendlyResponse);
  } else if (handled) {
    const n = (aiResult.transactions || []).length;
    await saveMessage(
      userNumber,
      'assistant',
      n > 0 ? `(mencatat ${n} transaksi: ${(aiResult.transactions || []).map((t) => `${t.description} ${t.amount}`).join(', ')})` : '(menangani perintah)'
    );
  }

  return handled;
}

router.post('/webhook', async (req, res) => {
  const { from, senderName, text, hasImage, imageFilePath } = req.body;
  if (!from) return res.status(400).json({ error: 'Missing "from" sender' });

  // Acknowledge webhook immediately to avoid timeout
  res.json({ received: true });

  // Tolak pesan dari grup atau nomor yang tidak terdaftar di ALLOWED_NUMBERS .env
  if (!isAllowedSender(from)) {
    console.log(`[finance-api] Pesan diabaikan (bukan chat pribadi atau nomor tidak terdaftar di .env): ${from}`);
    return;
  }

  // userNumber dinormalisasi secara kanonikal ke nomor telepon utama untuk database
  const userNumber = getCanonicalUserNumber(from);

  try {
    // 1. JIKA PESAN BERUPA FOTO STRUK ATAU RESI M-BANKING
    if (hasImage && imageFilePath) {
      await sendWhatsAppMessage(
        from,
        '🔍 *Sedang membaca bukti pembayaran/struk Anda...*\nMohon tunggu beberapa detik.'
      );

      try {
        const ocrResult = await extractReceiptData(imageFilePath);
        const {
          receiptType = 'struk_belanja',
          transactionType = 'expense',
          bankName,
          merchantName,
          recipientName,
          notes,
          totalAmount,
          date,
          items,
          category,
        } = ocrResult;

        if (!totalAmount || totalAmount <= 0) {
          return await sendWhatsAppMessage(
            from,
            '⚠️ Maaf, nominal transaksi tidak terbaca jelas pada gambar. Silakan catat manual, contoh: `transfer 150rb di BCA` atau `indomaret 45rb`'
          );
        }

        let description = notes || merchantName || recipientName || 'Transaksi';
        let itemListText = '';

        if (receiptType === 'm_banking') {
          description = notes
            ? `${notes} (${bankName ? `${bankName} ke ` : ''}${recipientName || merchantName || 'Penerima'})`
            : `Transfer ${bankName ? `${bankName} ke ` : ''}${recipientName || merchantName || 'Penerima'}`;
        } else if (items && items.length > 0) {
          description = items
            .map((i) => `${i.qty > 1 ? `${i.qty}x ` : ''}${i.name} (${formatRupiah(i.price)})`)
            .join(', ');
          itemListText = '\n*📦 Rincian Barang:*';
          items.forEach((item, idx) => {
            const qtyStr = item.qty > 1 ? ` (${item.qty}x)` : '';
            itemListText += `\n${idx + 1}. ${item.name}${qtyStr} — ${formatRupiah(item.price)}`;
          });
          itemListText += '\n';
        }

        const tx = await prisma.transaction.create({
          data: {
            userNumber,
            type: transactionType,
            source: receiptType === 'm_banking' ? 'ocr_mbanking' : 'ocr',
            amount: parseFloat(totalAmount),
            description,
            category: matchCategory(category) || category || (transactionType === 'income' ? 'Gaji & Pemasukan' : 'Belanja Bulanan'),
            merchantName: merchantName || recipientName || null,
            receiptImageUrl: imageFilePath,
          },
        });

        // Cek Status Budget jika Pengeluaran
        let budgetAlert = '';
        if (transactionType === 'expense') {
          const budgetStatus = await checkBudgetStatus(userNumber, tx.category);
          if (budgetStatus.hasBudget) {
            if (budgetStatus.isOverbudget) {
              budgetAlert = `\n\n🚨 *PERINGATAN OVERBUDGET:* Pengeluaran '${tx.category}' sudah MELEBIHI batas siklus! (Terpakai: ${formatRupiah(budgetStatus.totalSpent)} / Limit: ${formatRupiah(budgetStatus.monthlyLimit)})`;
            } else if (budgetStatus.isDailyCategory || budgetStatus.todayDailyLimit > 0) {
              if (budgetStatus.isTodayOver) {
                budgetAlert = `\n\n⚠️ *Batas Hari Ini (${tx.category}):* Terpakai ${formatRupiah(budgetStatus.todaySpent)} / Jatah ${formatRupiah(budgetStatus.todayDailyLimit)} (Over ${formatRupiah(Math.abs(budgetStatus.todayDailyRemaining))} hari ini)`;
              } else {
                budgetAlert = `\n\n💡 *Batas Hari Ini (${tx.category}):* Jatah ${formatRupiah(budgetStatus.todayDailyLimit)} | Keluar ${formatRupiah(budgetStatus.todaySpent)} | Sisa ${formatRupiah(budgetStatus.todayDailyRemaining)}`;
              }
            } else if (budgetStatus.isWarning) {
              budgetAlert = `\n\n⚠️ *Perhatian:* Pengeluaran '${tx.category}' sudah mencapai ${budgetStatus.percentage}% dari budget siklus ini (Sisa: ${formatRupiah(budgetStatus.remaining)})`;
            }
          }
        }

        let reply = '';
        const tipeLabel = transactionType === 'income' ? 'Pemasukan' : 'Pengeluaran';
        const iconTipe = transactionType === 'income' ? '💰' : '💸';

        if (receiptType === 'm_banking') {
          reply =
            `📱 *Resi M-Banking / Transfer Berhasil Dicatat!*\n\n` +
            `🏦 *Bank/Aplikasi:* ${bankName || 'M-Banking'}\n` +
            `👤 *Tujuan/Penerima:* ${recipientName || merchantName || '-'}\n` +
            `${iconTipe} *Nominal:* ${formatRupiah(tx.amount)} (${tipeLabel})\n` +
            `🏷️ *Kategori:* ${tx.category}\n` +
            (notes ? `📝 *Berita/Keterangan:* ${notes}\n` : '') +
            `📅 *Tanggal:* ${date || dayjs().format('DD/MM/YYYY')}\n` +
            budgetAlert +
            `\n\n_Ketik *batal* jika ingin membatalkan catatan ini, atau *budget* untuk melihat kuota._`;
        } else if (receiptType === 'qris') {
          reply =
            `📱 *Pembayaran QRIS Berhasil Dicatat!*\n\n` +
            `🏪 *Merchant/Toko:* ${merchantName || '-'}\n` +
            (bankName ? `🏦 *Aplikasi:* ${bankName}\n` : '') +
            `${iconTipe} *Nominal:* ${formatRupiah(tx.amount)} (${tipeLabel})\n` +
            `🏷️ *Kategori:* ${tx.category}\n` +
            `📅 *Tanggal:* ${date || dayjs().format('DD/MM/YYYY')}\n` +
            budgetAlert +
            `\n\n_Ketik *batal* jika ingin membatalkan catatan ini, atau *budget* untuk melihat kuota._`;
        } else {
          reply =
            `🧾 *Struk Belanja Berhasil Dicatat!*\n\n` +
            `🏪 *Toko/Merchant:* ${merchantName || '-'}\n` +
            `${iconTipe} *Total:* ${formatRupiah(tx.amount)} (${tipeLabel})\n` +
            `🏷️ *Kategori:* ${tx.category}\n` +
            `📅 *Tanggal:* ${date || dayjs().format('DD/MM/YYYY')}\n` +
            itemListText +
            budgetAlert +
            `\n\n_Ketik *batal* jika ingin membatalkan catatan ini, atau *budget* untuk melihat kuota._`;
        }

        return await sendWhatsAppMessage(from, reply);
      } catch (ocrErr) {
        console.error('Error saat OCR bukti pembayaran:', ocrErr);
        return await sendWhatsAppMessage(
          from,
          `⚠️ Gagal memproses gambar: ${ocrErr.message || 'Error OCR'}. Anda bisa mencatat manual: ketik misalnya \`transfer 150rb di BCA\``
        );
      }
    }

    // 2. JIKA PESAN BERUPA TEKS
    const parsed = parseMessage(text);
    if (!parsed) return;

    // Handle Commands
    if (parsed.isCommand) {
      // 2a. MENU BANTUAN
      if (parsed.action === 'help') {
        const helpMessage =
          `🤖 *Buku Kas WhatsApp - Panduan Penggunaan*\n\n` +
          `*1. Catat Pengeluaran (Bisa Banyak Sekaligus):*
• \`makan 25rb, es teh 5rb, parkir 2rb\`
• \`bensin 50rb sama rokok 35rb di SPBU\`
• \`rokok surya 35rb di warung\`
• \`nongkrong kopi 25k di Janji Jiwa\`

*2. Catat Pemasukan:*
• \`+gaji 4.1jt\`
• \`+pemasukan 500rb booster\`

*3. Edit & Pembatalan Transaksi:*
• \`ubah nominal 120rb\` (ganti nominal transaksi terakhir)
• \`ubah kategori bensin\` (ganti kategori transaksi terakhir)
• \`ubah catatan makan siang\` (ganti keterangan transaksi)
• \`galon ubah kategori ke makanan dan minuman\` (edit transaksi lama spesifik)
• \`batal\` (membatalkan transaksi terakhir)

*4. Pindah Dana & Alokasi Rekening:*
• \`pindah 800rb ke seabank\` (otomatis Tabungan & Darurat)
• \`pindah 3.3jt ke jago\` (pindah saldo operasional ke Bank Jago)
• \`pindah 400rb ke ortu\` (Kirim Keluarga via Bank Jago)
• \`13k pindahkan ke makanan dari uang bulanan\` (geser budget)
• \`pindah dana\` (panduan pemindahan & alokasi saldo)

*5. Tagihan & Langganan Rutin:*
• \`tagihan\` (lihat daftar & estimasi total bulanan)
• \`tambah tagihan wifi 350rb tgl 15\`
• \`bayar tagihan wifi\` (otomatis masuk ke pengeluaran)
• \`hapus tagihan wifi\`

*6. Catatan Hutang & Piutang:*
• \`hutang\` (cek seluruh buku hutang & piutang)
• \`pinjamkan Budi 100rb buat bensin\` (catat piutang)
• \`hutang ke Andi 50rb\` (catat hutang)
• \`lunas piutang Budi\` / \`lunas hutang Andi\`

*7. Kirim Foto Struk / M-Banking:*
• Kirim foto struk belanja atau bukti transfer m-banking, bot otomatis membaca nominal dan detailnya!

*8. Cek Alokasi Gaji & Anggaran:*
• \`alokasi\` (panduan alokasi gajian Tgl 21 & Tgl 1)
• \`budget\` (cek kuota & sisa hari dalam siklus gajian)
• \`budget hari ini\` / \`sisa hari ini\` (cek batas & sisa belanja hari ini)
• \`jatah makan hari ini\` (cek jatah kategori tertentu hari ini)
• \`set budget bensin 250rb\` (ubah limit anggaran)
• \`reset budget\` (kembalikan ke default Rp 4.600.000)

*9. Pengingat & Simulasi:*
• \`simulasi pengingat malam\` (tes notifikasi jam 22:30)
• \`simulasi alokasi 22\` (tes reminder alokasi SeaBank & Jago Tgl 22)
• \`simulasi gaji 21\` (tes pencatatan gaji pokok 4,1jt)
• \`simulasi gaji 1\` (tes pencatatan booster 500k)

*10. Cek Rekap & Ekspor:*
• \`rekap\` (hari ini) / \`rekap minggu ini\` / \`rekap bulan ini\`
• \`export excel\` (unduh laporan file Excel)
• \`restart keuangan\` (hapus semua data — konfirmasi 2 langkah)

*11. Aturan Pribadi & Insight AI:*
• \`kalau aku bilang ngopi masuk nongkrong\` (kata kunci otomatis masuk kantong tertentu)
• \`daftar aturan\` / \`hapus aturan ngopi\`
• \`insight\` (AI meringkas tren & saran dari data Anda)`;

        return await sendWhatsAppMessage(from, helpMessage);
      }

      // 2b. STATUS BUDGET SIKLUS GAJIAN
      if (parsed.action === 'budget') {
        const report = await generateBudgetReport(userNumber);
        return await sendWhatsAppMessage(from, report);
      }

      // 2b-1. STATUS BUDGET HARI INI
      if (parsed.action === 'today_budget') {
        const report = await generateTodayBudgetReport(userNumber, parsed.categoryInput);
        return await sendWhatsAppMessage(from, report);
      }

      // 2c. PANDUAN DUA SIKLUS GAJI
      if (parsed.action === 'allocation_guide') {
        const guide = getDualCycleGuide();
        return await sendWhatsAppMessage(from, guide);
      }

      // 2c-1. PANDUAN PINDAH DANA & ALOKASI REKENING
      if (parsed.action === 'fund_transfer_guide') {
        const guide =
          `🔄 *Panduan Pemindahan & Alokasi Saldo*\n\n` +
          `Untuk mencatat pemindahan uang antar bank atau alokasi ke kantong dompet, Anda cukup ketik:\n` +
          `• \`pindah 800rb ke seabank\` ➔ (Otomatis masuk Tabungan 300k & Darurat 500k)\n` +
          `• \`pindah 3.3jt ke jago\` ➔ (Pindah saldo operasional dari BSI ke Bank Jago)\n` +
          `• \`pindah 400rb ke ortu\` ➔ (Otomatis masuk kategori Kirim Keluarga)\n` +
          `• \`pindah 500rb ke dana darurat\` ➔ (Kategori Dana Darurat)\n` +
          `• \`pindah 300rb ke tabungan\` ➔ (Kategori Tabungan)\n` +
          `• \`pindah 1.2jt ke uang makan\` ➔ (Kategori Makanan & Minuman)\n\n` +
          `💡 *Alur Rutin Gajian Tanggal 21-22:*\n` +
          `1. BSI ➔ SeaBank: Rp 800.000 (Tabungan & Dana Darurat)\n` +
          `2. BSI ➔ Bank Jago: Rp 3.300.000 (Operasional & Kirim Ortu)\n\n` +
          `_Ketik \`alokasi 22\` untuk melihat panduan alokasi perbankan lengkap._`;

        return await sendWhatsAppMessage(from, guide);
      }

      // 2c-2. SIMULASI / TRIGGER PENGINGAT ALOKASI TGL 22
      if (parsed.action === 'trigger_allocation_reminder_22') {
        await sendWhatsAppMessage(from, '⏳ Menjalankan pengingat alokasi perbankan Tanggal 22 (SeaBank & Bank Jago)...');
        await executeAllocationReminder22(userNumber, true);
        return;
      }

      // 2d. SIMULASI / TRIGGER GAJI TGL 21 (4.1 JT)
      if (parsed.action === 'trigger_salary_21') {
        await sendWhatsAppMessage(from, '⏳ Memproses pencatatan/simulasi Gaji Pokok Tgl 21 (Rp 4.100.000)...');
        await executeSalary21(userNumber, true);
        return;
      }

      // 2e. SIMULASI / TRIGGER BOOSTER TGL 1 (500K)
      if (parsed.action === 'trigger_salary_1') {
        await sendWhatsAppMessage(from, '⏳ Memproses pencatatan/simulasi Booster Tgl 1 (Rp 500.000)...');
        await executeBooster1(userNumber, true);
        return;
      }

      // 2f. SIMULASI PENGINGAT MALAM HARI (22:30)
      if (parsed.action === 'trigger_nightly_reminder') {
        await sendWhatsAppMessage(from, '⏳ Menjalankan simulasi pengingat malam (22:30)...');
        await executeNightlyReminder(userNumber, true);
        return;
      }

      // 2g. PERMINTAAN RESTART KEUANGAN (KONFIRMASI 2 LANGKAH)
      if (parsed.action === 'request_reset_all_data') {
        pendingRestarts.set(userNumber, Date.now());
        const warn =
          `⚠️ *PERINGATAN: ANDA AKAN MENGHAPUS SELURUH RIWAYAT KEUANGAN!*\n\n` +
          `Perintah ini akan *MENGHAPUS SEMUA CATATAN TRANSAKSI* dan mengembalikan alokasi anggaran ke setelan awal Rp 4.600.000.\n\n` +
          `Ketik *KONFIRMASI RESTART* dalam 60 detik untuk melanjutkan.\n` +
          `_Jika tidak sengaja, abaikan pesan ini atau ketik pesan lain untuk membatalkan._`;

        return await sendWhatsAppMessage(from, warn);
      }

      // 2g-1. EKSEKUSI KONFIRMASI RESTART
      if (parsed.action === 'confirm_reset_all_data') {
        const requestTime = pendingRestarts.get(userNumber);
        if (!requestTime || Date.now() - requestTime > 60000) {
          pendingRestarts.delete(userNumber);
          return await sendWhatsAppMessage(
            from,
            'ℹ️ Tidak ada permintaan reset aktif atau batas waktu 60 detik telah kedaluwarsa. Data Anda tetap aman.'
          );
        }

        pendingRestarts.delete(userNumber);

        const count = await prisma.transaction.count({
          where: { userNumber },
        });

        await prisma.transaction.deleteMany({
          where: { userNumber },
        });

        await syncDefaultBudgets(userNumber);

        const reply =
          `🔄 *DATA KEUANGAN BERHASIL DI-RESTART!*\n\n` +
          `• 🗑️ *Total Transaksi Dihapus:* ${count} transaksi\n` +
          `• 💰 *Saldo Kas Sekarang:* Rp 0\n` +
          `• 🎯 *Alokasi Anggaran:* Di-reset ke standar Rp 4.600.000\n\n` +
          `Buku kas Anda sekarang telah bersih dan siap digunakan dari awal.\n` +
          `_Ketik 'budget' untuk cek kuota atau mulai catat pengeluaran baru Anda!_`;

        return await sendWhatsAppMessage(from, reply);
      }

      // 2g-2. QUICK EDIT TRANSAKSI TERAKHIR
      if (parsed.action === 'edit_last_tx') {
        const lastTx = await prisma.transaction.findFirst({
          where: { userNumber },
          orderBy: { createdAt: 'desc' },
        });

        if (!lastTx) {
          return await sendWhatsAppMessage(from, 'ℹ️ Belum ada transaksi untuk diubah.');
        }

        const { field, value } = parsed;
        let updateData = {};
        let changeNote = '';

        if (field === 'amount') {
          const oldAmt = lastTx.amount;
          updateData.amount = value;
          changeNote = `Nominal diubah dari *${formatRupiah(oldAmt)}* ➔ *${formatRupiah(value)}*`;
        } else if (field === 'category') {
          const oldCat = lastTx.category;
          const targetCategory = matchCategory(value) || value;
          updateData.category = targetCategory;
          changeNote = `Kategori diubah dari *${oldCat}* ➔ *${targetCategory}*`;
        } else if (field === 'description') {
          const oldDesc = lastTx.description;
          updateData.description = value;
          changeNote = `Keterangan diubah dari *${oldDesc}* ➔ *${value}*`;
        } else if (field === 'merchantName') {
          updateData.merchantName = value;
          changeNote = `Toko/Merchant diubah menjadi *${value}*`;
        }

        const updatedTx = await prisma.transaction.update({
          where: { id: lastTx.id },
          data: updateData,
        });

        let budgetAlert = '';
        if (updatedTx.type === 'expense') {
          const budgetStatus = await checkBudgetStatus(userNumber, updatedTx.category);
          if (budgetStatus.hasBudget) {
            if (budgetStatus.isOverbudget) {
              budgetAlert = `\n\n🚨 *PERINGATAN OVERBUDGET:* Pengeluaran '${updatedTx.category}' sudah MELEBIHI batas! (Terpakai: ${formatRupiah(budgetStatus.totalSpent)} / Limit: ${formatRupiah(budgetStatus.monthlyLimit)})`;
            } else if (budgetStatus.isWarning) {
              budgetAlert = `\n\n⚠️ *Perhatian:* Pengeluaran '${updatedTx.category}' sudah ${budgetStatus.percentage}% dari budget (Sisa: ${formatRupiah(budgetStatus.remaining)})`;
            } else {
              budgetAlert = `\n\n📊 *Sisa kuota ${updatedTx.category}:* ${formatRupiah(budgetStatus.remaining)} (Terpakai: ${formatRupiah(budgetStatus.totalSpent)})`;
            }
          }
        }

        const editReply =
          `✏️ *Transaksi Terakhir Berhasil Diperbarui!*\n\n` +
          `• ${changeNote}\n` +
          `• 📦 Barang/Keterangan: ${updatedTx.description}\n` +
          `• 🏷️ Kategori: ${updatedTx.category}\n` +
          `• 💰 Nominal: ${formatRupiah(updatedTx.amount)}` +
          budgetAlert +
          `\n\n_Ketik *batal* jika ingin membatalkan, atau *budget* untuk cek status._`;

        return await sendWhatsAppMessage(from, editReply);
      }

      // 2g-2b. EDIT KATEGORI DENGAN PENCARIAN (KATA KUNCI / BULAN / KATEGORI LAMA)
      // Contoh: "Belanja bulanan galon oktober ubah kategori ke makanan dan minuman"
      // Contoh: "galon ubah kategori ke makanan dan minuman"
      if (parsed.action === 'edit_tx_category_by_query') {
        const targetCategory = matchCategory(parsed.categoryInput);
        if (!targetCategory) {
          const catList = Object.keys(DEFAULT_BUDGETS).map((c) => `• ${c}`).join('\n');
          return await sendWhatsAppMessage(
            from,
            `⚠️ Kategori *'${parsed.categoryInput}'* tidak dikenali.\n\nPilih salah satu dari 10 kantong resmi berikut:\n${catList}`
          );
        }

        const filter = parseSearchQuery(parsed.query);
        console.log(`[edit_tx_category_by_query] Query: "${parsed.query}" -> Filter:`, filter);

        let where = { userNumber };

        if (filter.startDate && filter.endDate) {
          where.createdAt = { gte: filter.startDate, lte: filter.endDate };
        }

        if (filter.detectedOldCat) {
          where.category = filter.detectedOldCat;
        }

        if (filter.keyword) {
          where.OR = [
            { description: { contains: filter.keyword, mode: 'insensitive' } },
            { merchantName: { contains: filter.keyword, mode: 'insensitive' } },
          ];
        }

        let matchingTxs = await prisma.transaction.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: 5,
        });

        // Fallback 1: Jika tidak ditemukan dan ada detectedOldCat, coba lepaskan filter kategori lama
        if (matchingTxs.length === 0 && filter.detectedOldCat && filter.keyword) {
          delete where.category;
          matchingTxs = await prisma.transaction.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: 5,
          });
        }

        // Fallback 2: Jika masih belum ketemu dan ada filter waktu, coba cari tanpa batasan waktu
        if (matchingTxs.length === 0 && where.createdAt && filter.keyword) {
          delete where.createdAt;
          matchingTxs = await prisma.transaction.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: 5,
          });
        }

        // Fallback 3: Jika pencarian teks lengkap belum ketemu, pecah kata kunci (misal: "air minum galon rs" -> cari "galon", "minum", dll)
        if (matchingTxs.length === 0 && filter.keyword) {
          const words = filter.keyword.split(/\s+/).filter((w) => w.length >= 3);
          const sortedWords = [...words].sort((a, b) => b.length - a.length);
          for (const word of sortedWords) {
            const fallbackTxs = await prisma.transaction.findMany({
              where: {
                userNumber,
                OR: [
                  { description: { contains: word, mode: 'insensitive' } },
                  { merchantName: { contains: word, mode: 'insensitive' } },
                ],
              },
              orderBy: { createdAt: 'desc' },
              take: 5,
            });
            if (fallbackTxs.length > 0) {
              matchingTxs = fallbackTxs;
              break;
            }
          }
        }

        if (matchingTxs.length === 0) {
          return await sendWhatsAppMessage(
            from,
            `⚠️ Tidak ditemukan transaksi yang cocok dengan kata kunci *"${parsed.query}"*.\n\n` +
            `_Tips: Pastikan nama barang/keterangan yang pernah dicatat sudah sesuai (contoh: "ubah kategori galon ke makanan dan minuman")._`
          );
        }

        const txToUpdate = matchingTxs[0];
        const oldCategory = txToUpdate.category;

        const updatedTx = await prisma.transaction.update({
          where: { id: txToUpdate.id },
          data: { category: targetCategory },
        });

        let budgetAlert = '';
        if (updatedTx.type === 'expense') {
          const budgetStatus = await checkBudgetStatus(userNumber, targetCategory);
          if (budgetStatus.hasBudget) {
            budgetAlert = `\n\n📊 *Sisa kuota ${targetCategory}:* ${formatRupiah(budgetStatus.remaining)} (Terpakai: ${formatRupiah(budgetStatus.totalSpent)})`;
          }
        }

        const reply =
          `✏️ *Kategori Transaksi Berhasil Diperbarui!*\n\n` +
          `• 📦 *Barang/Catatan:* ${updatedTx.description}\n` +
          `• 🏷️ *Kategori:* ${oldCategory} ➔ *${targetCategory}*\n` +
          `• 💰 *Nominal:* ${formatRupiah(updatedTx.amount)}\n` +
          `• 📅 *Tanggal:* ${dayjs(updatedTx.createdAt).format('DD/MM/YYYY')}` +
          budgetAlert +
          `\n\n_Ketik *budget* untuk melihat pembaruan alokasi kuota Anda._`;

        return await sendWhatsAppMessage(from, reply);
      }

      // 2g-3. TAGIHAN RUTIN & SUBSCRIPTION
      if (parsed.action === 'list_bills') {
        const report = await generateBillReport(userNumber);
        return await sendWhatsAppMessage(from, report);
      }

      if (parsed.action === 'add_bill') {
        const res = await addBill(userNumber, parsed.name, parsed.amount, parsed.dueDay);
        const msg = res.isNew
          ? `✅ *Tagihan Rutin Berhasil Ditambahkan!*\n\n` +
            `• 📋 Nama: *${res.bill.name}*\n` +
            `• 💰 Nominal: ${formatRupiah(res.bill.amount)}\n` +
            `• 🗓️ Jatuh Tempo: Setiap tanggal ${res.bill.dueDay}\n` +
            `• 🏷️ Kategori: ${res.bill.category}\n\n` +
            `_Bot akan otomatis mengingatkan Anda saat mendekati tanggal jatuh tempo._`
          : `✅ *Tagihan Rutin '${res.bill.name}' Berhasil Diperbarui!*\n\n` +
            `• 💰 Nominal: ${formatRupiah(res.bill.amount)}\n` +
            `• 🗓️ Jatuh Tempo: Setiap tanggal ${res.bill.dueDay}\n` +
            `• 🏷️ Kategori: ${res.bill.category}`;

        return await sendWhatsAppMessage(from, msg);
      }

      if (parsed.action === 'pay_bill') {
        const res = await payBill(userNumber, parsed.name);
        if (!res.success) {
          return await sendWhatsAppMessage(from, `⚠️ ${res.error}`);
        }

        const budgetStatus = await checkBudgetStatus(userNumber, res.bill.category);
        let budgetAlert = '';
        if (budgetStatus.hasBudget) {
          budgetAlert = `\n📊 *Sisa kuota ${res.bill.category}:* ${formatRupiah(budgetStatus.remaining)}`;
        }

        const msg =
          `🎉 *Pelunasan Tagihan Berhasil Dicatat!*\n\n` +
          `• 📋 Tagihan: *${res.bill.name}*\n` +
          `• 💸 Nominal: ${formatRupiah(res.bill.amount)}\n` +
          `• 🏷️ Kategori: ${res.bill.category}` +
          budgetAlert +
          `\n\n✅ Transaksi otomatis tercatat ke pembukuan pengeluaran Anda.\n` +
          `_Ketik *tagihan* untuk melihat status tagihan lainnya._`;

        return await sendWhatsAppMessage(from, msg);
      }

      if (parsed.action === 'remove_bill') {
        const res = await removeBill(userNumber, parsed.name);
        if (!res.success) {
          return await sendWhatsAppMessage(from, `⚠️ ${res.error}`);
        }
        return await sendWhatsAppMessage(from, `🗑️ Tagihan rutin *${res.bill.name}* telah dinonaktifkan.`);
      }

      // 2g-4. BUKU CATATAN HUTANG & PIUTANG
      if (parsed.action === 'list_debts') {
        const report = await generateDebtReport(userNumber);
        return await sendWhatsAppMessage(from, report);
      }

      if (parsed.action === 'add_debt') {
        const debt = await addDebt(
          userNumber,
          parsed.debtType,
          parsed.personName,
          parsed.amount,
          parsed.description
        );
        const isLoan = debt.type === 'loan';
        const title = isLoan ? '🟢 Piutang Baru Dicatat (Uang Anda di Orang Lain)' : '🔴 Hutang Baru Dicatat (Kewajiban Anda)';
        const personLabel = isLoan ? 'Peminjam' : 'Pemberi Pinjaman';
        const descText = debt.description ? `\n• 📝 Catatan: ${debt.description}` : '';

        const msg =
          `📒 *${title}*\n\n` +
          `• 👤 ${personLabel}: *${debt.personName}*\n` +
          `• 💰 Nominal: ${formatRupiah(debt.amount)}` +
          descText +
          `\n• 🕒 Tanggal: ${dayjs(debt.createdAt).format('DD/MM/YYYY')}\n\n` +
          `_Ketik *hutang* untuk melihat buku hutang atau \`lunas ${debt.personName}\` jika sudah diselesaikan._`;

        return await sendWhatsAppMessage(from, msg);
      }

      if (parsed.action === 'settle_debt') {
        const res = await settleDebt(userNumber, parsed.personName);
        if (!res.success) {
          return await sendWhatsAppMessage(from, `⚠️ ${res.error}`);
        }

        const isLoan = res.debt.type === 'loan';
        const title = isLoan ? '🟢 Piutang Telah Dilunasi' : '🔴 Hutang Anda Telah Dilunasi';

        const msg =
          `🎉 *${title}!*\n\n` +
          `• 👤 Atas Nama: *${res.debt.personName}*\n` +
          `• 💰 Nominal: ${formatRupiah(res.debt.amount)}\n` +
          `• 🕒 Waktu Pelunasan: ${dayjs(res.debt.paidAt).format('DD/MM/YYYY HH:mm')}\n\n` +
          (isLoan
            ? `💡 _Jika uang yang diterima ingin dicatat sebagai uang masuk ke kas, ketik: \`+pemasukan ${res.debt.amount} pelunasan piutang ${res.debt.personName}\`_`
            : `✅ Kewajiban hutang Anda kepada ${res.debt.personName} telah ditandai lunas.`);

        return await sendWhatsAppMessage(from, msg);
      }

      // 2h. RESET ANGGARAN KE STANDAR RP 4.600.000
      if (parsed.action === 'reset_budget') {
        await syncDefaultBudgets(userNumber);
        const reply =
          `✅ *Anggaran Berhasil Di-Reset ke Standar Alokasi!*\n\n` +
          `Total Anggaran: *Rp 4.600.000* (Gaji Pokok 4,1jt + Booster 500k).\n\n` +
          `_Ketik *budget* untuk melihat seluruh batas kuota._`;
        return await sendWhatsAppMessage(from, reply);
      }

      // 2i. UBAH LIMIT BUDGET
      if (parsed.action === 'set_budget') {
        const input = parsed.categoryInput.toLowerCase();
        const availableCats = Object.keys(DEFAULT_BUDGETS);
        let matchedCat = availableCats.find(
          (c) => c.toLowerCase().includes(input) || input.includes(c.toLowerCase())
        );

        if (!matchedCat) {
          matchedCat = parsed.categoryInput;
        }

        await updateCategoryBudget(userNumber, matchedCat, parsed.amount);

        const reply =
          `✅ *Batas Anggaran Berhasil Diperbarui!*\n\n` +
          `🎯 *Kategori:* ${matchedCat}\n` +
          `💵 *Limit Baru:* ${formatRupiah(parsed.amount)} / siklus\n\n` +
          `_Ketik *budget* untuk melihat seluruh status anggaran._`;

        return await sendWhatsAppMessage(from, reply);
      }

      // 2h-2. ATURAN KATEGORI PRIBADI
      if (parsed.action === 'list_rules') {
        const rules = await listRules(userNumber);
        return await sendWhatsAppMessage(
          from,
          `⚙️ *ATURAN KATEGORI PRIBADI*\n\n${formatRuleList(rules)}\n\n` +
            `_Tambah: \`kalau aku bilang ngopi masuk nongkrong\`_\n` +
            `_Hapus: \`hapus aturan ngopi\`_`
        );
      }

      if (parsed.action === 'add_rule') {
        const res = await addRule(userNumber, parsed.keyword, parsed.categoryInput);
        if (!res.success) {
          return await sendWhatsAppMessage(from, `⚠️ ${res.error}`);
        }
        return await sendWhatsAppMessage(
          from,
          `${res.isNew ? '✅ *Aturan Baru Disimpan!*' : '✅ *Aturan Diperbarui!*'}\n\n` +
            `• 🔑 Kata kunci: *${res.rule.keyword}*\n` +
            `• 🏷️ Otomatis masuk: *${res.rule.category}*\n\n` +
            `_Mulai sekarang setiap transaksi yang menyebut "${res.rule.keyword}" akan masuk kantong itu._`
        );
      }

      if (parsed.action === 'remove_rule') {
        const res = await removeRule(userNumber, parsed.keyword);
        if (!res.success) {
          return await sendWhatsAppMessage(from, `⚠️ ${res.error}`);
        }
        return await sendWhatsAppMessage(from, `🗑️ Aturan *${res.rule.keyword}* dinonaktifkan.`);
      }

      if (parsed.action === 'trigger_weekly_insight') {
        await sendWhatsAppMessage(from, '⏳ Menyusun insight mingguan dari data Anda...');
        await executeWeeklyInsight(userNumber, true);
        return;
      }

      // 2i. REKAP LAPORAN
      if (parsed.action === 'rekap') {
        const { start, end, label } = getPeriodRange(parsed.period);

        const transactions = await prisma.transaction.findMany({
          where: {
            userNumber,
            createdAt: { gte: start, lte: end },
          },
          orderBy: { createdAt: 'desc' },
        });

        let totalIncome = 0;
        let totalExpense = 0;
        const categoryMap = {};

        transactions.forEach((t) => {
          if (t.type === 'income') {
            totalIncome += t.amount;
          } else {
            totalExpense += t.amount;
            categoryMap[t.category] = (categoryMap[t.category] || 0) + t.amount;
          }
        });

        const netBalance = totalIncome - totalExpense;

        let categoryBreakdown = '';
        const sortedCats = Object.entries(categoryMap).sort((a, b) => b[1] - a[1]);
        if (sortedCats.length > 0) {
          categoryBreakdown = '\n\n*Rincian Pengeluaran:*';
          sortedCats.forEach(([cat, amt]) => {
            const pct = totalExpense > 0 ? Math.round((amt / totalExpense) * 100) : 0;
            categoryBreakdown += `\n• ${cat}: ${formatRupiah(amt)} (${pct}%)`;
          });
        }

        const report =
          `📊 *REKAP KEUANGAN ${label.toUpperCase()}*\n\n` +
          `💰 *Total Pemasukan:* ${formatRupiah(totalIncome)}\n` +
          `💸 *Total Pengeluaran:* ${formatRupiah(totalExpense)}\n` +
          `📈 *Sisa Saldo:* ${formatRupiah(netBalance)}\n` +
          `📝 *Jumlah Transaksi:* ${transactions.length}` +
          categoryBreakdown +
          `\n\n_Ketik 'budget' untuk cek sisa kuota atau 'export excel' untuk laporan detail._`;

        return await sendWhatsAppMessage(from, report);
      }

      // 2j. BATAL / UNDO TERAKHIR (Mendukung pembatalan multi-item sekaligus)
      if (parsed.action === 'undo') {
        const lastTx = await prisma.transaction.findFirst({
          where: { userNumber },
          orderBy: { createdAt: 'desc' },
        });

        if (!lastTx) {
          return await sendWhatsAppMessage(from, 'ℹ️ Tidak ada transaksi untuk dibatalkan.');
        }

        // Batalkan berdasarkan batchId dari satu pesan multi-item.
        // Sebelumnya memakai heuristik jendela 4 detik yang bisa ikut menghapus
        // transaksi lain yang kebetulan dicatat berdekatan.
        const recentTxs = lastTx.batchId
          ? await prisma.transaction.findMany({
              where: { userNumber, batchId: lastTx.batchId },
              orderBy: { createdAt: 'desc' },
            })
          : [];

        if (recentTxs.length > 1) {
          await prisma.transaction.deleteMany({
            where: { id: { in: recentTxs.map((t) => t.id) } },
          });

          let itemsDeleted = recentTxs
            .map((t, idx) => `${idx + 1}. ${t.description} — ${formatRupiah(t.amount)} (${t.category})`)
            .join('\n');

          const undoReply =
            `🗑️ *${recentTxs.length} Transaksi Terakhir Dibatalkan Sekaligus!*\n\n` +
            itemsDeleted;

          return await sendWhatsAppMessage(from, undoReply);
        }

        await prisma.transaction.delete({ where: { id: lastTx.id } });

        const undoReply =
          `🗑️ *Transaksi Terakhir Dibatalkan!*\n\n` +
          `• Tipe: ${lastTx.type === 'income' ? 'Pemasukan' : 'Pengeluaran'}\n` +
          `• Nominal: ${formatRupiah(lastTx.amount)}\n` +
          `• Keterangan: ${lastTx.description}\n` +
          `• Kategori: ${lastTx.category}`;

        return await sendWhatsAppMessage(from, undoReply);
      }

      // 2k. EKSPOR EXCEL
      if (parsed.action === 'export') {
        await sendWhatsAppMessage(from, '⏳ Sedang menyiapkan file Excel laporan keuangan Anda...');

        const transactions = await prisma.transaction.findMany({
          where: { userNumber },
          orderBy: { createdAt: 'asc' },
        });

        if (transactions.length === 0) {
          return await sendWhatsAppMessage(from, 'ℹ️ Belum ada transaksi untuk diekspor.');
        }

        const { exportPath, fileName, totalIncome, totalExpense } =
          await generateFinancialExcel(transactions, `Laporan Keuangan ${userNumber}`);

        const caption =
          `📄 *Laporan Keuangan Berhasil Dibuat!*\n` +
          `• Total Pemasukan: ${formatRupiah(totalIncome)}\n` +
          `• Total Pengeluaran: ${formatRupiah(totalExpense)}\n` +
          `• Total Transaksi: ${transactions.length}`;

        return await sendWhatsAppDocument(from, exportPath, fileName, caption);
      }
    }

    // 3. Jalur cepat: simpan dulu pesan user ke memori, supaya AI tetap punya
    //    konteks walau pesan ini ternyata cukup dicatat lewat parser regex.
    await saveMessage(userNumber, 'user', text);

    // 3a. JALUR CEPAT: parser regex untuk pesan yang sudah pasti & lengkap.
    //    "makan siang 35rb" tidak perlu memanggil AI (hemat kuota, respons instan).
    const adaKlarifikasi = await hasPendingClarification(userNumber);
    if (!adaKlarifikasi && isConfidentParse(parsed, text)) {
      if (parsed.isPocketShift && parsed.data) {
        const reply = await executePocketShiftOperation(userNumber, from, parsed.data);
        await saveMessage(userNumber, 'assistant', `(anggaran digeser: ${parsed.data.fromPocket} -> ${parsed.data.toPocket} ${parsed.data.amount})`);
        return reply;
      }
      if (parsed.isTransfer && parsed.data) {
        const reply = await executeTransferOperation(userNumber, from, parsed.data);
        await saveMessage(userNumber, 'assistant', `(transfer dicatat: ${parsed.data.amount} ke ${parsed.data.toTarget || 'kantong'})`);
        return reply;
      }
      const items = parsed.items || (parsed.data ? [parsed.data] : []);
      if (items.length > 0) {
        const reply = await executeTransactionsOperation(
          userNumber,
          from,
          items,
          items.length > 1 ? 'manual_multi' : 'manual'
        );
        // Konfirmasi ini penting: jadi riwayat AI menandakan transaksi SUDAH tercatat.
        await saveMessage(
          userNumber,
          'assistant',
          `(tercatat: ${items.map((item) => `${item.description} ${item.amount}`).join(', ')})`
        );
        return reply;
      }
    }

    // 4. AI: menjawab klarifikasi yang tertunda, obrolan bebas, pertanyaan data,
    //    atau pesan yang nominalnya belum lengkap tertangkap parser.
    if (await runAiBranch(userNumber, from, text, senderName)) return;

    // 5. AI tidak tersedia: tetap catat apa yang bisa dibaca parser regex,
    //    daripada menjawab "format pesan belum dikenali".
    if (parsed && (parsed.isPocketShift || parsed.isTransfer || (parsed.isTransaction && parsed.items && parsed.items.length > 0))) {
      if (parsed.isPocketShift && parsed.data) {
        return await executePocketShiftOperation(userNumber, from, parsed.data);
      }
      if (parsed.isTransfer && parsed.data) {
        return await executeTransferOperation(userNumber, from, parsed.data);
      }
      const items = parsed.items || (parsed.data ? [parsed.data] : []);
      if (items.length > 0) {
        return await executeTransactionsOperation(
          userNumber,
          from,
          items,
          items.length > 1 ? 'manual_multi' : 'manual'
        );
      }
    }

    // 6. FORMAT PESAN TIDAK DIKENALI
    const unknownReply =
      `Halo *${senderName}*! Format pesan belum dikenali.\n\n` +
      `Contoh cepat:\n` +
      `• \`makan 25rb di warteg\`\n` +
      `• \`makan 25rb, es teh 5rb, parkir 2rb\` (catat banyak sekaligus)\n` +
      `• \`rokok surya 35rb di warung\`\n` +
      `• \`galon ubah kategori ke makanan dan minuman\` (edit transaksi lama)\n` +
      `• \`pindah 800rb ke seabank\` (alokasi saldo simpanan)\n` +
      `• \`pindah dana\` (panduan pemindahan saldo)\n` +
      `• \`budget\` (cek kuota anggaran & sisa hari)\n` +
      `• \`alokasi\` (panduan alokasi bank)\n` +
      `• Kirim foto struk belanja / m-banking\n\n` +
      `💡 _Anda juga bisa curhat atau cerita pengeluaran bebas dengan bahasa santai, Gemini AI kami akan langsung memahaminya!_\n\n` +
      `Ketik *bantuan* untuk melihat semua menu.`;

    await sendWhatsAppMessage(from, unknownReply);
  } catch (err) {
    console.error('Error handling webhook:', err);
    await sendWhatsAppMessage(from, `⚠️ Terjadi kesalahan: ${err.message}`);
  }
});

module.exports = router;
