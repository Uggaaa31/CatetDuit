const express = require('express');
const router = express.Router();
const prisma = require('../db');
const { parseMessage, isConversationalText, detectCategory, countNominals, parseMultiAction } = require('../services/nlpParser');
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
const { addRule, listRules, removeRule, applyRules, applyTextAliases, formatRuleList } = require('../services/ruleService');

// Map untuk konfirmasi 2 langkah perintah berbahaya (TTL 60 detik)
const pendingRestarts = new Map();

function formatRupiah(number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(number);
}

// ---------------------------------------------------------------------------
// Kode rujukan transaksi (ref).
//
// Setiap konfirmasi transaksi menyertakan kode pendek seperti "#a1b2c3". User
// bisa memakai kode itu untuk menunjuk transaksi tertentu, baik dengan membalas
// (reply/quote) pesan konfirmasi bot maupun dengan mengetik kodenya langsung:
//   "ubah nominal 30rb #a1b2c3"  /  balas pesan konfirmasi lalu: "salah, 30rb"
// ---------------------------------------------------------------------------
function refCode(id) {
  const clean = String(id || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return clean.length >= 6 ? `#${clean.slice(-6)}` : `#${clean}`;
}

function refTag(id) {
  return refCode(id);
}

function extractRefCode(text) {
  const match = String(text || '').match(/#([a-z0-9]{3,12})\b/i);
  return match ? match[1].toLowerCase() : null;
}

async function findTransactionByRef(userNumber, code) {
  if (!code) return null;
  const recent = await prisma.transaction.findMany({
    where: { userNumber },
    orderBy: { createdAt: 'desc' },
    take: 60,
  });
  const needle = String(code).toLowerCase();
  return (
    recent.find((tx) =>
      String(tx.id || '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toLowerCase()
        .endsWith(needle)
    ) || null
  );
}

/**
 * Cari transaksi yang dimaksud dari kode ref atau dari pesan yang dibalas.
 * Urutan prioritas:
 *   1. Kode ref di pesan user         -> "ubah nominal 30rb #a1b2c3"
 *   2. Kode ref di pesan yang dibalas -> user membalas pesan konfirmasi bot
 *   3. Nominal di pesan yang dibalas  -> konfirmasi lama tanpa kode ref
 */
async function resolveReferencedTransaction(userNumber, refCodeInput, quoted) {
  // Terima kode polos ("a1b2c3") maupun teks pesan yang memuat kode ("...#a1b2c3").
  const raw = refCodeInput ? String(refCodeInput).trim() : '';
  const explicit = /^[a-z0-9]{4,12}$/i.test(raw) ? raw.toLowerCase() : extractRefCode(raw);
  if (explicit) {
    const tx = await findTransactionByRef(userNumber, explicit);
    if (tx) return { tx, via: 'kode ref' };
  }

  const quotedText = quoted && typeof quoted.text === 'string' ? quoted.text : '';
  const quotedRef = extractRefCode(quotedText);
  if (quotedRef) {
    const tx = await findTransactionByRef(userNumber, quotedRef);
    if (tx) return { tx, via: 'pesan yang Anda balas' };
  }

  if (quotedText) {
    const amountMatch =
      quotedText.match(/(?:nominal|total)[^0-9]{0,12}([0-9][0-9.]*)/i) ||
      quotedText.match(/Rp\s?([0-9][0-9.]*)/i);
    if (amountMatch) {
      const amount = parseInt(String(amountMatch[1]).replace(/\./g, ''), 10);
      if (amount > 0) {
        const recent = await prisma.transaction.findMany({
          where: { userNumber },
          orderBy: { createdAt: 'desc' },
          take: 30,
        });
        const tx = recent.find((t) => Math.abs(Number(t.amount) - amount) < 1);
        if (tx) return { tx, via: 'nominal di pesan yang Anda balas' };
      }
    }
  }

  return null;
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

async function executeCrossPocketOperation(userNumber, from, pocketData) {
  const { description, amount, donorInput } = pocketData;

  const itemCategory = detectCategory(description, 'expense', amount);
  const donorCategory = matchCategory(donorInput);

  if (!donorCategory) {
    const catList = Object.keys(DEFAULT_BUDGETS)
      .map((c) => `• ${c}`)
      .join('\n');
    return await sendWhatsAppMessage(
      from,
      `⚠ Kantong penambal *${donorInput}* tidak dikenali.\n\n` +
        `Kantong yang tersedia:\n${catList}\n\n` +
        `_Contoh: *beli kuota 100rb, lebihnya ambil dari makanan*_`
    );
  }

  if (donorCategory === itemCategory) {
    return await sendWhatsAppMessage(
      from,
      `⚠ Kantong utama dan kantong penambal sama (${itemCategory}).\n` +
        `_Sebutkan kantong lain, misal: lebihnya ambil dari tabungan._`
    );
  }

  const itemStatus = await checkBudgetStatus(userNumber, itemCategory);
  const donorStatus = await checkBudgetStatus(userNumber, donorCategory);

  const itemAvailable = itemStatus.hasBudget ? Math.max(0, itemStatus.remaining) : 0;
  const donorAvailable = donorStatus.hasBudget ? Math.max(0, donorStatus.remaining) : 0;

  // Kasus A: kantong utama masih cukup -> catat normal, tidak perlu subsidi
  if (itemAvailable >= amount) {
    return await executeTransactionsOperation(
      userNumber,
      from,
      [
        {
          type: 'expense',
          amount,
          description,
          category: itemCategory,
          merchantName: null,
          customDate: null,
          source: 'manual',
        },
      ],
      'manual'
    );
  }

  const shortfall = amount - itemAvailable;

  if (donorAvailable < shortfall) {
    return await sendWhatsAppMessage(
      from,
      `⚠️ *Subsidi Silang Tidak Cukup*\n\n` +
        `• 📝 *Catatan:* ${description}\n` +
        `• 💰 *Total:* ${formatRupiah(amount)}\n` +
        `• 📊 Sisa kuota ${itemCategory}: ${formatRupiah(itemAvailable)}\n` +
        `• ❗ Kurang: *${formatRupiah(shortfall)}*\n` +
        `• 📦 Sisa kuota ${donorCategory}: ${formatRupiah(donorAvailable)}\n\n` +
        `_Sisa kuota ${donorCategory} tidak cukup menambal._`
    );
  }

  // Kasus B: split dua transaksi (kantong utama + kantong penambal)
  const primaryAmount = itemAvailable;
  const subsidyAmount = shortfall;
  let primaryTx = null;

  if (primaryAmount > 0) {
    primaryTx = await prisma.transaction.create({
      data: {
        userNumber,
        type: 'expense',
        source: 'manual',
        amount: primaryAmount,
        description,
        category: itemCategory,
      },
    });
  }

  const subsidyTx = await prisma.transaction.create({
    data: {
      userNumber,
      type: 'expense',
      source: 'manual',
      amount: subsidyAmount,
      description: `${description} (subsidi silang dari ${donorCategory})`,
      category: donorCategory,
    },
  });

  const itemAfter = await checkBudgetStatus(userNumber, itemCategory);
  const donorAfter = await checkBudgetStatus(userNumber, donorCategory);

  const dailyBlock = (status) => {
    if (!status || !status.hasBudget || !(status.isDailyCategory || status.todayDailyLimit > 0)) return '';
    if (status.isTodayOver) {
      return `   └ Jatah harian: keluar ${formatRupiah(status.todaySpent)} dari ${formatRupiah(status.todayDailyLimit)} → lebih ${formatRupiah(Math.abs(status.todayDailyRemaining))} (jatah besok ${formatRupiah(status.nextDayAllowance)})`;
    }
    return `   └ Jatah harian: sisa ${formatRupiah(status.todayDailyRemaining)} dari ${formatRupiah(status.todayDailyLimit)} (keluar ${formatRupiah(status.todaySpent)})`;
  };

  const reply =
    `✅ *Pengeluaran Dicatat (Subsidi Antar Kantong)*\n\n` +
    `• 📝 *Catatan:* ${description}\n` +
    `• 💰 *Total:* ${formatRupiah(amount)}\n\n` +
    `*Pemotongan:*\n` +
    (primaryAmount > 0
      ? `1. ${itemCategory}: *${formatRupiah(primaryAmount)}* (kuota habis)\n` +
        `2. ${donorCategory}: *${formatRupiah(subsidyAmount)}* (menambal kekurangan)\n`
      : `1. ${donorCategory}: *${formatRupiah(subsidyAmount)}* (ditambal penuh)\n`) +
    `• 📊 Sisa kuota ${donorCategory}: ${formatRupiah(donorAfter.remaining)}\n\n` +
    `_Ketik *batal* jika keliru._`;

  return await sendWhatsAppMessage(from, reply);
}

async function executePocketShiftOperation(userNumber, from, shiftData) {
  const { amount, fromPocket, toPocket } = shiftData;

  const result = await transferPocketBudget(userNumber, fromPocket, toPocket, amount);
  if (!result.success) {
    return await sendWhatsAppMessage(from, `⚠ Gagal menggeser anggaran: ${result.error}`);
  }

  const reply =
    `✅ *Anggaran Berhasil Dipindahkan!*\n\n` +
    `• 💰 *Nominal:* ${formatRupiah(result.amount)}\n` +
    `• 📤 *Dari:* ${result.fromCategory} (sisa: ${formatRupiah(result.fromRemaining)})\n` +
    `• 📥 *Ke:* ${result.toCategory} (sisa: ${formatRupiah(result.toRemaining)})\n\n` +
    `_Ketik *budget* untuk melihat status anggaran._`;

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
      `✅ *Alokasi SeaBank Berhasil Dicatat!*\n\n` +
      `• 🛡️ *Dana Darurat:* Rp 500.000\n` +
      `• 📈 *Tabungan:* Rp 300.000\n` +
      `• 💰 *Total:* ${formatRupiah(finalAmount)}\n\n` +
      `_Ketik *budget* untuk melihat status kuota tabungan._`;

    return await sendWhatsAppMessage(from, reply);
  }

  // Kasus B: Pemindahan Saldo Operasional Antar Bank (misal BSI ke Bank Jago)
  if (transferType === 'bank_to_bank' || (toTarget && toTarget.toLowerCase().includes('jago'))) {
    const reply =
      `✅ *Pindah Saldo Bank Berhasil Dicatat!*\n\n` +
      `• 📤 *Dari:* ${fromBank || 'BSI'}\n` +
      `• 📥 *Ke:* ${toTarget || 'Bank Jago'}\n` +
      `• 💰 *Nominal:* ${formatRupiah(numAmount)}\n\n` +
      `_Saldo siap dipakai untuk kebutuhan harian._`;

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
      `• 👤 *Tujuan:* ${person}\n` +
      `• 💰 *Nominal:* ${formatRupiah(tx.amount)}\n` +
      `• 🏷️ *Kategori:* ${tx.category}` +
      budgetNote +
      `\n\n_Ketik *batal* jika keliru._`;

    return await sendWhatsAppMessage(from, reply);
  }

  // Kasus C: Alokasi ke Kantong Tertentu (Ortu, Dana Darurat, Tabungan, Makan, dll)
  const targetCategory = category || 'Belanja Bulanan';
  const pocketTx = await prisma.transaction.create({
    data: {
      userNumber,
      type: 'expense',
      source: 'transfer_pocket',
      amount: numAmount,
      description: `Alokasi ke ${toTarget || targetCategory}`,
      category: targetCategory,
    },
  });

  const budgetStatus = await checkBudgetStatus(userNumber, targetCategory);
  let budgetNote = '';
  if (budgetStatus.hasBudget) {
    budgetNote = `\n📊 *Sisa Kuota ${targetCategory}:* ${formatRupiah(budgetStatus.remaining)}`;
  }

  const reply =
    `✅ *Alokasi Kantong Berhasil Dicatat!*\n\n` +
    `• 📥 *Tujuan:* ${toTarget || targetCategory}\n` +
    `• 💰 *Nominal:* ${formatRupiah(numAmount)}\n` +
    `• 🏷️ *Kategori:* ${targetCategory}` +
    budgetNote +
    `\n\n_Ketik *budget* untuk melihat sisa kuota._`;

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

    const isIncome = tx.type === 'income';
    const label = isIncome ? 'Pemasukan' : 'Pengeluaran';

    let reply =
      `✅ *${label} Dicatat*\n\n` +
      `• 💰 *Nominal:* ${formatRupiah(tx.amount)}\n` +
      `• 🏷️ *Kategori:* ${tx.category}\n` +
      `• 📝 *Catatan:* ${tx.description}\n`;

    if (tx.merchantName) {
      reply += `• 🏪 *Toko:* ${tx.merchantName}\n`;
    }

    if (customDate) {
      reply += `• 📅 *Tanggal:* ${dayjs(tx.createdAt).format('DD/MM/YYYY')}\n`;
    }

    if (items[0].ruleKeyword) {
      reply += `• ⚙️ *Aturan:* "${items[0].ruleKeyword}" → ${tx.category}\n`;
    }

    if (!isIncome) {
      const budgetStatus = await checkBudgetStatus(userNumber, tx.category);
      if (budgetStatus.hasBudget) {
        if (budgetStatus.isOverbudget) {
          reply += `\n🚨 *Overbudget:* Kuota '${tx.category}' sudah melebihi batas! (Terpakai: ${formatRupiah(budgetStatus.totalSpent)} / Limit: ${formatRupiah(budgetStatus.monthlyLimit)})`;
        } else if (budgetStatus.isDailyCategory || budgetStatus.todayDailyLimit > 0) {
          if (budgetStatus.isTodayOver) {
            reply += `\n⚠️ *Jatah Hari Ini:* Keluar ${formatRupiah(budgetStatus.todaySpent)} (Lebih ${formatRupiah(Math.abs(budgetStatus.todayDailyRemaining))} dari jatah ${formatRupiah(budgetStatus.todayDailyLimit)})`;
          } else {
            reply += `\n💡 *Jatah Hari Ini:* Sisa ${formatRupiah(budgetStatus.todayDailyRemaining)} (dari ${formatRupiah(budgetStatus.todayDailyLimit)})\n📊 *Sisa Kuota Bulanan:* ${formatRupiah(budgetStatus.remaining)}`;
          }
        } else if (budgetStatus.isWarning) {
          reply += `\n⚠️ *Perhatian:* Sisa kuota ${tx.category} tinggal ${formatRupiah(budgetStatus.remaining)} (${budgetStatus.percentage}% terpakai)`;
        } else {
          reply += `\n📊 *Sisa Kuota ${tx.category}:* ${formatRupiah(budgetStatus.remaining)}`;
        }
      }
    }

    if (badgeText) {
      reply += `\n\n${badgeText}`;
    }

    reply += `\n\n_Ketik *batal* jika keliru._`;
    return await sendWhatsAppMessage(from, reply);
  }

  // Multi-item
  let totalExpense = 0;
  let totalIncome = 0;
  const createdTxs = [];
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
    itemListText += `${idx + 1}. ${icon} ${tx.description}${merch} — *${formatRupiah(tx.amount)}* _(${tx.category})_\n`;
  });

  let summaryText = '';
  if (totalExpense > 0 && totalIncome > 0) {
    summaryText = `💸 *Total Keluar:* ${formatRupiah(totalExpense)}\n💰 *Total Masuk:* ${formatRupiah(totalIncome)}`;
  } else if (totalIncome > 0) {
    summaryText = `💰 *Total Masuk:* ${formatRupiah(totalIncome)}`;
  } else {
    summaryText = `💸 *Total Keluar:* ${formatRupiah(totalExpense)}`;
  }

  let budgetAlerts = [];
  const expenseCats = [...new Set(createdTxs.filter((t) => t.type === 'expense').map((t) => t.category))];
  for (const cat of expenseCats) {
    const budgetStatus = await checkBudgetStatus(userNumber, cat);
    if (budgetStatus.hasBudget) {
      if (budgetStatus.isOverbudget) {
        budgetAlerts.push(`🚨 *${cat}* melebihi batas kuota!`);
      } else if (budgetStatus.isDailyCategory || budgetStatus.todayDailyLimit > 0) {
        if (budgetStatus.isTodayOver) {
          budgetAlerts.push(`⚠️ *Jatah Hari Ini (${cat}):* Lebih ${formatRupiah(Math.abs(budgetStatus.todayDailyRemaining))}`);
        } else {
          budgetAlerts.push(`💡 *Jatah Hari Ini (${cat}):* Sisa ${formatRupiah(budgetStatus.todayDailyRemaining)}`);
        }
      } else if (budgetStatus.isWarning) {
        budgetAlerts.push(`⚠️ *${cat}* sudah ${budgetStatus.percentage}% terpakai (Sisa: ${formatRupiah(budgetStatus.remaining)})`);
      }
    }
  }

  const alertBlock = budgetAlerts.length > 0 ? `\n${budgetAlerts.join('\n')}\n` : '';
  const badgeBlock = badgeText ? `\n${badgeText}\n` : '';

  const reply =
    `✅ *${createdTxs.length} Transaksi Dicatat*\n\n` +
    itemListText +
    `═══════════════════════\n` +
    summaryText + '\n' +
    alertBlock +
    badgeBlock +
    `\n_Ketik *batal* jika keliru._`;

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
  if (parsed.isCrossPocket && parsed.data) return true;
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
      '⚠ _Kuota AI sedang habis. Pesan transaksi tetap saya proses dengan mode cepat (tanpa AI), tapi obrolan bebas belum bisa dilayani._'
    );
    return false;
  }

  if (aiResult.unavailable) {
    await notifyAiIssue(
      from,
      userNumber,
      '⚠ _Asisten AI sedang tidak tersedia. Pesan Anda tetap saya proses dengan mode cepat (tanpa AI)._\n_Cek status: buka /health pada service OCR._'
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
      '⚙ _(Dianalisis & dicatat otomatis oleh Gemini AI)_'
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

// Ambil fungsi handler POST /webhook dari stack router Express, supaya satu
// pesan multi-aksi bisa dijalankan ulang lewat jalur kode yang sama persis.
function ambilHandlerWebhook() {
  try {
    const layer = router.stack.find((l) => l.route && l.route.path === '/webhook');
    if (!layer || !layer.route || !Array.isArray(layer.route.stack) || layer.route.stack.length === 0) {
      return null;
    }
    const kandidat = layer.route.stack[layer.route.stack.length - 1];
    return kandidat && typeof kandidat.handle === 'function' ? kandidat.handle : null;
  } catch (err) {
    console.warn('[finance-api] Tidak bisa mengambil handler webhook:', err.message);
    return null;
  }
}

router.post('/webhook', async (req, res) => {
  const { from, senderName, text: rawText, hasImage, imageFilePath } = req.body;
  // Pesan yang sedang dibalas user (quote/reply), dikirim oleh whatsapp-gateway.
  const quoted =
    req.body.quoted && typeof req.body.quoted === 'object' && req.body.quoted.id
      ? req.body.quoted
      : null;
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
    let text = rawText || '';

    // 0. ALIAS PRIBADI: ganti dulu kata kunci pribadi sebelum pesan diurai.
    //    Contoh: "goceng" -> "5000", "brg" -> "bensin", "warung" -> "di warung bu ida".
    //    Dilewati pada sub-aksi multi-aksi (teksnya sudah diganti oleh induknya).
    if (!req.body.__multiChild) {
      const aliasResult = await applyTextAliases(userNumber, text);
      text = aliasResult.text;
      if (aliasResult.applied.length > 0) {
        const detail = aliasResult.applied.map((a) => `${a.keyword} → ${a.value}`).join(', ');
        console.log(`[finance-api] Alias pribadi diterapkan: ${detail} | pesan jadi: "${text}"`);
      }
    }

    // 0b. MULTI-AKSI: satu pesan berisi beberapa perintah/transaksi sekaligus.
    //     Contoh: "catat bensin 50rb, hapus parkir tadi, terus cek jatah makan"
    if (!req.body.__multiChild) {
      const multi = parseMultiAction(text);
      if (multi && multi.clauses.length > 1) {
        const subHandler = ambilHandlerWebhook();
        if (subHandler) {
          const daftar = multi.labels.map((label, i) => `${i + 1}. ${label}`).join('\n');
          await sendWhatsAppMessage(
            from,
            `▥ *Terbaca ${multi.clauses.length} aksi dalam satu pesan:*\n${daftar}\n\n_Saya kerjakan satu per satu, mohon tunggu sebentar._`
          );

          for (const clause of multi.clauses) {
            try {
              await subHandler(
                {
                  body: {
                    ...req.body,
                    text: clause,
                    hasImage: false,
                    imageFilePath: null,
                    __multiChild: true,
                  },
                },
                {
                  json() { return this; },
                  status() { return this; },
                  setHeader() { return this; },
                  end() { return this; },
                }
              );
            } catch (err) {
              console.error(`[finance-api] Sub-aksi "${clause}" gagal:`, err.message);
              await sendWhatsAppMessage(from, `⚠ Gagal mengerjakan "${clause}": ${err.message}`);
            }
          }
          return;
        }
      }
    }

    // 1. JIKA PESAN BERUPA FOTO STRUK ATAU RESI M-BANKING
    if (hasImage && imageFilePath) {
      await sendWhatsAppMessage(
        from,
        '⏳ *Sedang membaca bukti pembayaran/struk Anda...*\nMohon tunggu beberapa detik.'
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
          itemListText = '\n*📋 Rincian Barang:*';
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
              budgetAlert = `\n\n⚠ *PERINGATAN OVERBUDGET:* Pengeluaran '${tx.category}' sudah MELEBIHI batas siklus! (Terpakai: ${formatRupiah(budgetStatus.totalSpent)} / Limit: ${formatRupiah(budgetStatus.monthlyLimit)})`;
            } else if (budgetStatus.isDailyCategory || budgetStatus.todayDailyLimit > 0) {
              if (budgetStatus.isTodayOver) {
                budgetAlert = `\n\n⚠️ *Jatah Hari Ini:* Keluar ${formatRupiah(budgetStatus.todaySpent)} (Lebih ${formatRupiah(Math.abs(budgetStatus.todayDailyRemaining))} dari jatah ${formatRupiah(budgetStatus.todayDailyLimit)})`;
              } else {
                budgetAlert = `\n\n💡 *Jatah Hari Ini:* Sisa ${formatRupiah(budgetStatus.todayDailyRemaining)} (dari ${formatRupiah(budgetStatus.todayDailyLimit)})\n📊 *Sisa Kuota Bulanan:* ${formatRupiah(budgetStatus.remaining)}`;
              }
            } else if (budgetStatus.isWarning) {
              budgetAlert = `\n\n⚠️ *Perhatian:* Sisa kuota ${tx.category} tinggal ${formatRupiah(budgetStatus.remaining)} (${budgetStatus.percentage}% terpakai)`;
            }
          }
        }

        let reply = '';
        const tipeLabel = transactionType === 'income' ? 'Pemasukan' : 'Pengeluaran';

        if (receiptType === 'm_banking') {
          reply =
            `📱 *Bukti Transfer Dicatat*\n\n` +
            `• 🏦 *Bank:* ${bankName || 'M-Banking'}\n` +
            `• 👤 *Tujuan:* ${recipientName || merchantName || '-'}\n` +
            `• 💰 *Nominal:* ${formatRupiah(tx.amount)} _(${tipeLabel})_\n` +
            `• 🏷️ *Kategori:* ${tx.category}\n` +
            (notes ? `• 📝 *Keterangan:* ${notes}\n` : '') +
            `• 📅 *Tanggal:* ${date || dayjs().format('DD/MM/YYYY')}` +
            budgetAlert +
            `\n\n_Ketik *batal* jika keliru._`;
        } else if (receiptType === 'qris') {
          reply =
            `📱 *Pembayaran QRIS Dicatat*\n\n` +
            `• 🏪 *Merchant:* ${merchantName || '-'}\n` +
            (bankName ? `• 🏦 *Aplikasi:* ${bankName}\n` : '') +
            `• 💰 *Nominal:* ${formatRupiah(tx.amount)} _(${tipeLabel})_\n` +
            `• 🏷️ *Kategori:* ${tx.category}\n` +
            `• 📅 *Tanggal:* ${date || dayjs().format('DD/MM/YYYY')}` +
            budgetAlert +
            `\n\n_Ketik *batal* jika keliru._`;
        } else {
          reply =
            `🧾 *Struk Belanja Dicatat*\n\n` +
            `• 🏪 *Toko:* ${merchantName || '-'}\n` +
            `• 💰 *Total:* ${formatRupiah(tx.amount)} _(${tipeLabel})_\n` +
            `• 🏷️ *Kategori:* ${tx.category}\n` +
            `• 📅 *Tanggal:* ${date || dayjs().format('DD/MM/YYYY')}\n` +
            itemListText +
            budgetAlert +
            `\n\n_Ketik *batal* jika keliru._`;
        }

        return await sendWhatsAppMessage(from, reply);
      } catch (ocrErr) {
        console.error('Error saat OCR bukti pembayaran:', ocrErr);
        return await sendWhatsAppMessage(
          from,
          `⚠ Gagal memproses gambar: ${ocrErr.message || 'Error OCR'}. Anda bisa mencatat manual: ketik misalnya \`transfer 150rb di BCA\``
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
          `⚙ *Buku Kas WhatsApp - Panduan Penggunaan*\n\n` +
          `*1. Catat Pengeluaran (Bisa Banyak Sekaligus):*
• \`makan 25rb, es teh 5rb, parkir 2rb\`
• \`bensin 50rb sama rokok 35rb di SPBU\`
• \`rokok surya 35rb di warung\`
• \`nongkrong kopi 25k di Janji Jiwa\`

*2. Catat Pemasukan:*
• \`+gaji 4.1jt\`
• \`+pemasukan 500rb booster\`

*3. Edit & Ralat Percakapan Alami:*
• \`eh sate tadi maksudnya 35rb bukan 45rb\` (ralat nominal percakapan)
• \`pindahin kopi tadi ke kantong nongkrong\` (pindah kategori/pos)
• \`yang 5rb tadi bukan es teh tapi parkir\` (ralat barang & kategori otomatis)
• \`batalin sate tadi\` (batalkan catatan transaksi spesifik)
• \`ubah nominal 120rb\` / \`ubah kategori bensin\`
• \`batal\` (membatalkan transaksi terakhir)
• \`#a1b2c3 jadi 30rb\` (ralat transaksi memakai kode Ref)
• _Balas pesan konfirmasi transaksi, lalu tulis_ \`salah, 30rb\` _atau_ \`batalin ini\`

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
• \`beli kuota 100rb, lebihnya ambil dari makanan\` (subsidi silang antar kantong)
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

*12. Fleksibel: Alias Pribadi & Multi-Aksi:*
• \`kalau aku bilang goceng maksudnya 5000\` (alias nominal)
• \`kalau aku bilang brg maksudnya bensin\` (alias singkatan)
• \`kalau aku bilang warkop maksudnya di warung bu ida\` (alias merchant)
• \`atur alias goceng jadi 5000\` (cara singkat membuat alias)
• \`catat bensin 50rb, hapus parkir tadi, terus cek jatah makan\` (3 aksi sekaligus)
• \`bnsin 50rb\` / \`internat 100rb\` (typo & singkatan tetap dimengerti)`;

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
          `♻ *Panduan Pemindahan & Alokasi Saldo*\n\n` +
          `Untuk mencatat pemindahan uang antar bank atau alokasi ke kantong dompet, Anda cukup ketik:\n` +
          `• \`pindah 800rb ke seabank\` ➔ (Otomatis masuk Tabungan 300k & Darurat 500k)\n` +
          `• \`pindah 3.3jt ke jago\` ➔ (Pindah saldo operasional dari BSI ke Bank Jago)\n` +
          `• \`pindah 400rb ke ortu\` ➔ (Otomatis masuk kategori Kirim Keluarga)\n` +
          `• \`pindah 500rb ke dana darurat\` ➔ (Kategori Dana Darurat)\n` +
          `• \`pindah 300rb ke tabungan\` ➔ (Kategori Tabungan)\n` +
          `• \`pindah 1.2jt ke uang makan\` ➔ (Kategori Makanan & Minuman)\n\n` +
          `*Alur Rutin Gajian Tanggal 21-22:*\n` +
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
            'Tidak ada permintaan reset aktif atau batas waktu 60 detik telah kedaluwarsa. Data Anda tetap aman.'
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
          `♻️ *DATA KEUANGAN BERHASIL DI-RESET*\n\n` +
          `• 🗑️ Total Dihapus: ${count} transaksi\n` +
          `• 💰 Saldo Kas: Rp 0\n` +
          `• 🎯 Anggaran: Kembali ke standar Rp 4.600.000\n\n` +
          `_Buku kas telah bersih dan siap digunakan kembali._`;

        return await sendWhatsAppMessage(from, reply);
      }

      // 2g-1. CONVERSATIONAL EDIT (RALAT PERCAKAPAN ALAMI)
      // Contoh: "eh sate tadi maksudnya 35rb bukan 45rb ya", "pindahin kopi tadi ke kantong nongkrong dong",
      // "yang 5rb tadi bukan es teh, tapi parkir", "batalin sate tadi"
      if (parsed.action === 'conversational_edit') {
        const { subAction, targetKeyword, targetAmount, newAmount, categoryInput, newDescription } = parsed;

        // Ambil transaksi terbaru pengguna (15 transaksi terakhir)
        const recentTxs = await prisma.transaction.findMany({
          where: { userNumber },
          orderBy: { createdAt: 'desc' },
          take: 15,
        });

        if (!recentTxs || recentTxs.length === 0) {
          return await sendWhatsAppMessage(from, 'Belum ada transaksi yang tercatat untuk diralat.');
        }

        let targetTx = null;
        let targetVia = '';

        // Prioritas 0: user menunjuk transaksi tertentu lewat balasan (quote) atau kode ref.
        const referenced = await resolveReferencedTransaction(userNumber, parsed.refCode, quoted);
        if (referenced && referenced.tx) {
          targetTx = referenced.tx;
          targetVia = referenced.via;
        }

        // Prioritas 1: Pencocokan berdasarkan nominal spesifik (misal: "yang 5rb tadi")
        if (!targetTx && targetAmount) {
          targetTx = recentTxs.find((tx) => Math.abs(tx.amount - targetAmount) < 1);
        }

        // Prioritas 2: Pencocokan kata kunci barang / merchant / kategori
        if (!targetTx && targetKeyword) {
          const kw = targetKeyword.toLowerCase();
          targetTx = recentTxs.find((tx) => tx.description.toLowerCase().includes(kw));
          if (!targetTx) {
            targetTx = recentTxs.find((tx) => (tx.merchantName || '').toLowerCase().includes(kw));
          }
          if (!targetTx) {
            targetTx = recentTxs.find((tx) => tx.category.toLowerCase().includes(kw));
          }
        }

        // Prioritas 3: Transaksi paling terakhir
        if (!targetTx) {
          targetTx = recentTxs[0];
        }

        // 1. Aksi Hapus / Pembatalan Tertarget
        if (subAction === 'delete') {
          await prisma.transaction.delete({
            where: { id: targetTx.id },
          });

          let budgetInfo = '';
          if (targetTx.type === 'expense') {
            try {
              const status = await checkBudgetStatus(userNumber, targetTx.category);
              if (status && status.hasBudget) {
                budgetInfo = `\n\n📊 *Sisa Kuota ${targetTx.category}:* ${formatRupiah(status.remaining)}`;
              }
            } catch (err) {
              console.error('[conversational_edit:delete] Gagal hitung budget:', err.message);
            }
          }

          const cancelReply =
            `🗑️ *Transaksi Dibatalkan!*\n\n` +
            `• 📝 *Catatan:* ${targetTx.description}\n` +
            `• 🏷️ *Kategori:* ${targetTx.category}\n` +
            `• 💰 *Nominal:* ${formatRupiah(targetTx.amount)}` +
            budgetInfo;

          return await sendWhatsAppMessage(from, cancelReply);
        }

        // 2. Aksi Update (Nominal, Kategori, atau Deskripsi)
        let updateData = {};
        let changeTitle = 'Transaksi Berhasil Diralat!';
        let changeBullet = '';

        if (subAction === 'edit_amount') {
          const oldAmt = targetTx.amount;
          updateData.amount = newAmount;
          changeBullet = `💰 Nominal: *${formatRupiah(oldAmt)}* ➔ *${formatRupiah(newAmount)}*`;
        } else if (subAction === 'edit_category') {
          const oldCat = targetTx.category;
          const targetCategory = matchCategory(categoryInput) || categoryInput;
          updateData.category = targetCategory;
          changeBullet = `🏷️ Kategori: *${oldCat}* ➔ *${targetCategory}*`;
        } else if (subAction === 'edit_description') {
          const oldDesc = targetTx.description;
          updateData.description = newDescription;
          changeBullet = `📝 Catatan: *${oldDesc}* ➔ *${newDescription}*`;
          const autoCat = detectCategory(newDescription, targetTx.type, targetTx.amount) || matchCategory(newDescription);
          if (autoCat && autoCat !== targetTx.category) {
            updateData.category = autoCat;
            changeBullet += `\n• 🏷️ Kategori otomatis dialihkan ke: *${autoCat}*`;
          }
        }

        const updatedTx = await prisma.transaction.update({
          where: { id: targetTx.id },
          data: updateData,
        });

        // Hitung status jatah hari ini & budget terbaru
        let budgetContext = '';
        if (updatedTx.type === 'expense') {
          try {
            const todayStatus = await checkBudgetStatus(userNumber, updatedTx.category);
            if (todayStatus && todayStatus.hasBudget) {
              if (todayStatus.isTodayOver) {
                budgetContext = `\n\n⚠️ *Jatah Hari Ini:* Keluar ${formatRupiah(todayStatus.todaySpent)} (Lebih ${formatRupiah(Math.abs(todayStatus.todayDailyRemaining))} dari jatah ${formatRupiah(todayStatus.todayDailyLimit)})`;
              } else {
                budgetContext = `\n\n💡 *Jatah Hari Ini:* Sisa ${formatRupiah(todayStatus.todayDailyRemaining)} (dari ${formatRupiah(todayStatus.todayDailyLimit)})\n📊 *Sisa Kuota Bulanan:* ${formatRupiah(todayStatus.remaining)}`;
              }
            }
          } catch (err) {
            console.error('[conversational_edit] Gagal hitung status budget:', err.message);
          }
        }

        const replyMsg =
          `✏️ *Transaksi Diralat*\n\n` +
          `• ${changeBullet}\n\n` +
          `*Data Sekarang:*\n` +
          `• 📝 ${updatedTx.description}\n` +
          `• 🏷️ ${updatedTx.category}\n` +
          `• 💰 ${formatRupiah(updatedTx.amount)}` +
          budgetContext;

        return await sendWhatsAppMessage(from, replyMsg);
      }


      // 2g-2. QUICK EDIT TRANSAKSI TERAKHIR
      if (parsed.action === 'edit_last_tx') {
        // Kalau user membalas pesan konfirmasi lama atau menulis kode ref,
        // yang diedit adalah transaksi itu — bukan transaksi paling akhir.
        const referencedEdit = await resolveReferencedTransaction(userNumber, parsed.refCode, quoted);
        const lastTx =
          (referencedEdit && referencedEdit.tx) ||
          (await prisma.transaction.findFirst({
            where: { userNumber },
            orderBy: { createdAt: 'desc' },
          }));

        if (!lastTx) {
          return await sendWhatsAppMessage(from, 'i Belum ada transaksi untuk diubah.');
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
              budgetAlert = `\n\n🚨 *Overbudget:* Kuota '${updatedTx.category}' sudah melebihi batas! (Terpakai: ${formatRupiah(budgetStatus.totalSpent)} / Limit: ${formatRupiah(budgetStatus.monthlyLimit)})`;
            } else if (budgetStatus.isWarning) {
              budgetAlert = `\n\n⚠️ *Perhatian:* Sisa kuota ${updatedTx.category} tinggal ${formatRupiah(budgetStatus.remaining)} (${budgetStatus.percentage}% terpakai)`;
            } else {
              budgetAlert = `\n\n📊 *Sisa Kuota ${updatedTx.category}:* ${formatRupiah(budgetStatus.remaining)}`;
            }
          }
        }

        const editReply =
          `✏️ *Transaksi Terakhir Diperbarui*\n\n` +
          `• ${changeNote}\n` +
          `• 📝 *Catatan:* ${updatedTx.description}\n` +
          `• 🏷️ *Kategori:* ${updatedTx.category}\n` +
          `• 💰 *Nominal:* ${formatRupiah(updatedTx.amount)}` +
          budgetAlert +
          `\n\n_Ketik *batal* jika keliru._`;

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
            `⚠ Kategori *'${parsed.categoryInput}'* tidak dikenali.\n\nPilih salah satu dari 10 kantong resmi berikut:\n${catList}`
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
            `⚠ Tidak ditemukan transaksi yang cocok dengan kata kunci *"${parsed.query}"*.\n\n` +
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
            budgetAlert = `\n\n📊 *Sisa Kuota ${targetCategory}:* ${formatRupiah(budgetStatus.remaining)}`;
          }
        }

        const reply =
          `✏️ *Kategori Berhasil Diperbarui*\n\n` +
          `• 📝 *Catatan:* ${updatedTx.description}\n` +
          `• 🏷️ *Kategori:* ${oldCategory} ➔ *${targetCategory}*\n` +
          `• 💰 *Nominal:* ${formatRupiah(updatedTx.amount)}\n` +
          `• 📅 *Tanggal:* ${dayjs(updatedTx.createdAt).format('DD/MM/YYYY')}` +
          budgetAlert;

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
          ? `✅ *Tagihan Rutin Ditambahkan*\n\n` +
            `• 📋 Nama: *${res.bill.name}*\n` +
            `• 💰 Nominal: ${formatRupiah(res.bill.amount)}\n` +
            `• 📅 Jatuh Tempo: Setiap tgl ${res.bill.dueDay}\n` +
            `• 🏷️ Kategori: ${res.bill.category}\n\n` +
            `_Bot akan mengingatkan saat mendekati jatuh tempo._`
          : `✅ *Tagihan Rutin '${res.bill.name}' Diperbarui*\n\n` +
            `• 💰 Nominal: ${formatRupiah(res.bill.amount)}\n` +
            `• 📅 Jatuh Tempo: Setiap tgl ${res.bill.dueDay}\n` +
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
          `✅ *Pelunasan Tagihan Dicatat*\n\n` +
          `• 📋 Tagihan: *${res.bill.name}*\n` +
          `• 💰 Nominal: ${formatRupiah(res.bill.amount)}\n` +
          `• 🏷️ Kategori: ${res.bill.category}` +
          budgetAlert +
          `\n\n_Ketik *tagihan* untuk melihat status tagihan lainnya._`;

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
        const title = isLoan ? 'Piutang Baru Dicatat' : 'Hutang Baru Dicatat';
        const personLabel = isLoan ? 'Peminjam' : 'Pemberi Pinjaman';
        const descText = debt.description ? `\n• 📝 Catatan: ${debt.description}` : '';

        const msg =
          `📝 *${title}*\n\n` +
          `• 👤 ${personLabel}: *${debt.personName}*\n` +
          `• 💰 Nominal: ${formatRupiah(debt.amount)}` +
          descText +
          `\n• 📅 Tanggal: ${dayjs(debt.createdAt).format('DD/MM/YYYY')}\n\n` +
          `_Ketik *hutang* untuk cek daftar atau \`lunas ${debt.personName}\` jika sudah lunas._`;

        return await sendWhatsAppMessage(from, msg);
      }

      if (parsed.action === 'settle_debt') {
        const res = await settleDebt(userNumber, parsed.personName);
        if (!res.success) {
          return await sendWhatsAppMessage(from, `⚠️ ${res.error}`);
        }

        const isLoan = res.debt.type === 'loan';
        const title = isLoan ? 'Piutang Telah Dilunasi' : 'Hutang Anda Telah Dilunasi';

        const msg =
          `✅ *${title}*\n\n` +
          `• 👤 Atas Nama: *${res.debt.personName}*\n` +
          `• 💰 Nominal: ${formatRupiah(res.debt.amount)}\n` +
          `• 📅 Waktu: ${dayjs(res.debt.paidAt).format('DD/MM/YYYY HH:mm')}`;

        return await sendWhatsAppMessage(from, msg);
      }

      // 2h. RESET ANGGARAN KE STANDAR RP 4.600.000
      if (parsed.action === 'reset_budget') {
        await syncDefaultBudgets(userNumber);
        const reply =
          `✅ *Anggaran Di-Reset ke Standar!*\n\n` +
          `Total Anggaran: *Rp 4.600.000* (Gaji Pokok 4,1jt + Booster 500k).\n\n` +
          `_Ketik *budget* untuk melihat seluruh kuota._`;
        return await sendWhatsAppMessage(from, reply);
      }

      // 2i. UBAH LIMIT BUDGET
      if (parsed.action === 'set_budget') {
        const input = parsed.categoryInput.toLowerCase();
        const availableCats = Object.keys(DEFAULT_BUDGETS);

        // Toleransi typo nama kantong: "bnsin" -> Bensin & Transportasi.
        let matchedCat = matchCategory(parsed.categoryInput);

        if (!matchedCat) {
          matchedCat = availableCats.find(
            (c) => c.toLowerCase().includes(input) || input.includes(c.toLowerCase())
          );
        }

        if (!matchedCat) {
          const catList = availableCats.map((c) => `• ${c}`).join('\n');
          return await sendWhatsAppMessage(
            from,
            `⚠️ Kantong *'${parsed.categoryInput}'* tidak dikenali.\n\nPilih salah satu:\n${catList}`
          );
        }

        await updateCategoryBudget(userNumber, matchedCat, parsed.amount);

        const reply =
          `✅ *Limit Anggaran Diperbarui*\n\n` +
          `• 🏷️ *Kategori:* ${matchedCat}\n` +
          `• 💰 *Limit Baru:* ${formatRupiah(parsed.amount)} / siklus\n\n` +
          `_Ketik *budget* untuk melihat seluruh status anggaran._`;

        return await sendWhatsAppMessage(from, reply);
      }

      // 2h-2. ATURAN KATEGORI PRIBADI
      if (parsed.action === 'list_rules') {
        const rules = await listRules(userNumber);
        return await sendWhatsAppMessage(
          from,
          `⚙ *ATURAN KATEGORI PRIBADI*\n\n${formatRuleList(rules)}\n\n` +
            `_Tambah: \`kalau aku bilang ngopi masuk nongkrong\`_\n` +
            `_Hapus: \`hapus aturan ngopi\`_`
        );
      }

      if (parsed.action === 'add_rule') {
        const isAlias = parsed.kind === 'text';
        const res = await addRule(userNumber, parsed.keyword, parsed.categoryInput, parsed.kind);
        if (!res.success) {
          return await sendWhatsAppMessage(from, `⚠ ${res.error}`);
        }

        if (isAlias) {
          return await sendWhatsAppMessage(
            from,
            `${res.isNew ? '✅ *Alias Baru Disimpan!*' : '✅ *Alias Diperbarui!*'}\n\n` +
              `• 🔑 Kata kunci: *${res.rule.keyword}*\n` +
              `• 🔄 Diganti jadi: *${res.rule.category}*\n\n` +
              `_Setiap Anda menulis "${res.rule.keyword}", otomatis dibaca "${res.rule.category}"._`
          );
        }

        return await sendWhatsAppMessage(
          from,
          `${res.isNew ? '✅ *Aturan Baru Disimpan!*' : '✅ *Aturan Diperbarui!*'}\n\n` +
            `• 🔑 Kata kunci: *${res.rule.keyword}*\n` +
            `• 🏷️ Kategori: *${res.rule.category}*\n\n` +
            `_Transaksi dengan kata "${res.rule.keyword}" otomatis masuk kategori ini._`
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
          `• 💰 *Total Pemasukan:* ${formatRupiah(totalIncome)}\n` +
          `• 💸 *Total Pengeluaran:* ${formatRupiah(totalExpense)}\n` +
          `• 📈 *Selisih Saldo:* ${formatRupiah(netBalance)}\n` +
          `• 📝 *Total Transaksi:* ${transactions.length}` +
          categoryBreakdown +
          `\n\n_Ketik *budget* untuk cek sisa kuota._`;

        return await sendWhatsAppMessage(from, report);
      }

      // 2j. BATAL / UNDO TERAKHIR
      if (parsed.action === 'undo') {
        const referencedUndo = await resolveReferencedTransaction(userNumber, parsed.refCode, quoted);
        if (referencedUndo && referencedUndo.tx) {
          const tx = referencedUndo.tx;
          await prisma.transaction.delete({ where: { id: tx.id } });

          const targetedReply =
            `🗑️ *Transaksi Dibatalkan!*\n\n` +
            `• 📝 Catatan: ${tx.description}\n` +
            `• 🏷️ Kategori: ${tx.category}\n` +
            `• 💰 Nominal: ${formatRupiah(tx.amount)}`;

          return await sendWhatsAppMessage(from, targetedReply);
        }

        const lastTx = await prisma.transaction.findFirst({
          where: { userNumber },
          orderBy: { createdAt: 'desc' },
        });

        if (!lastTx) {
          return await sendWhatsAppMessage(from, 'Belum ada transaksi untuk dibatalkan.');
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
            .map((t, idx) => `${idx + 1}. ${t.description} — ${formatRupiah(t.amount)} _(${t.category})_`)
            .join('\n');

          const undoReply =
            `🗑️ *${recentTxs.length} Transaksi Dibatalkan!*\n\n` +
            itemsDeleted;

          return await sendWhatsAppMessage(from, undoReply);
        }

        await prisma.transaction.delete({ where: { id: lastTx.id } });

        const undoReply =
          `🗑️ *Transaksi Terakhir Dibatalkan!*\n\n` +
          `• 📝 *Catatan:* ${lastTx.description}\n` +
          `• 💰 *Nominal:* ${formatRupiah(lastTx.amount)}\n` +
          `• 🏷️ *Kategori:* ${lastTx.category}`;

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
          return await sendWhatsAppMessage(from, 'Belum ada transaksi untuk diekspor.');
        }

        const { exportPath, fileName, totalIncome, totalExpense } =
          await generateFinancialExcel(transactions, `Laporan Keuangan ${userNumber}`);

        const caption =
          `📊 *Laporan Keuangan Selesai Dibuat!*\n\n` +
          `• 💰 Total Pemasukan: ${formatRupiah(totalIncome)}\n` +
          `• 💸 Total Pengeluaran: ${formatRupiah(totalExpense)}\n` +
          `• 📝 Total Transaksi: ${transactions.length}`;

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
      if (parsed.isCrossPocket && parsed.data) {
        const reply = await executeCrossPocketOperation(userNumber, from, parsed.data);
        await saveMessage(userNumber, 'assistant', `(belanja subsidi silang: ${parsed.data.description} ${parsed.data.amount}, penambal ${parsed.data.donorInput})`);
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
    if (parsed && (parsed.isPocketShift || parsed.isCrossPocket || parsed.isTransfer || (parsed.isTransaction && parsed.items && parsed.items.length > 0))) {
      if (parsed.isPocketShift && parsed.data) {
        return await executePocketShiftOperation(userNumber, from, parsed.data);
      }
      if (parsed.isCrossPocket && parsed.data) {
        return await executeCrossPocketOperation(userNumber, from, parsed.data);
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
      `Halo *${senderName}*! Pesan belum dipahami.\n\n` +
      `*Contoh cara catat:*\n` +
      `• \`makan 25rb\`\n` +
      `• \`makan 25rb, es teh 5rb, parkir 2rb\`\n` +
      `• \`+gaji 4.1jt\` (pemasukan)\n` +
      `• \`budget\` (cek sisa anggaran)\n` +
      `• Kirim foto struk belanja / m-banking\n\n` +
      `_Ketik *bantuan* untuk melihat menu lengkap._`;

    await sendWhatsAppMessage(from, unknownReply);
  } catch (err) {
    console.error('Error handling webhook:', err);
    await sendWhatsAppMessage(from, `⚠ Terjadi kesalahan: ${err.message}`);
  }
});

module.exports = router;
