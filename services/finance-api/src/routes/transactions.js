const express = require('express');
const router = express.Router();
const prisma = require('../db');
const { sendWhatsAppMessage } = require('../services/waClient');
const { getPrimaryUserNumber } = require('../config');
const { detectCategory } = require('../services/nlpParser');
const { checkBudgetStatus } = require('../services/budgetService');
const dayjs = require('dayjs');

function formatRupiah(number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(number);
}

function getDefaultUserNumber() {
  // Nomor pengguna utama diambil dari PRIMARY_USER_NUMBER (.env), dengan
  // fallback ke nomor HP valid pertama di ALLOWED_NUMBERS.
  return getPrimaryUserNumber() || 'default_user';
}

// POST /transactions (Dipanggil oleh email-watcher atau integrasi lain)
router.post('/', async (req, res) => {
  try {
    const {
      amount,
      description,
      merchantName,
      type = 'expense',
      source = 'email_qris',
      bankName,
      category,
      notificationRaw,
      userNumber = getDefaultUserNumber(),
    } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Nominal amount wajib diisi dan harus > 0' });
    }

    // Klasifikasi kategori otomatis ke 10 kantong resmi jika belum spesifik
    let finalCategory = category;
    if (!finalCategory || finalCategory === 'Pembayaran QRIS / Bank' || finalCategory === 'Lain-lain') {
      const textToClassify = `${merchantName || ''} ${description || ''}`.trim();
      finalCategory = detectCategory(textToClassify, type, parseFloat(amount));
    }

    const tx = await prisma.transaction.create({
      data: {
        userNumber,
        type,
        source,
        amount: parseFloat(amount),
        description: description || 'Transaksi Otomatis',
        category: finalCategory,
        merchantName: merchantName || null,
        notificationRaw: notificationRaw || null,
      },
    });

    console.log(`[Transactions] Transaksi baru tersimpan ID: ${tx.id} (${finalCategory}) dari ${source}`);

    // Cek status anggaran jika pengeluaran
    let budgetAlert = '';
    if (tx.type === 'expense') {
      const budgetStatus = await checkBudgetStatus(userNumber, tx.category);
      if (budgetStatus.hasBudget) {
        if (budgetStatus.isOverbudget) {
          budgetAlert = `\n🚨 *PERINGATAN OVERBUDGET:* Pengeluaran '${tx.category}' sudah MELEBIHI batas! (Terpakai: ${formatRupiah(budgetStatus.totalSpent)} / Limit: ${formatRupiah(budgetStatus.monthlyLimit)})\n`;
        } else if (budgetStatus.isWarning) {
          budgetAlert = `\n⚠️ *Perhatian:* Pengeluaran '${tx.category}' sudah mencapai ${budgetStatus.percentage}% dari budget siklus ini (Sisa: ${formatRupiah(budgetStatus.remaining)})\n`;
        } else if (tx.category === 'Makanan & Minuman' && budgetStatus.remaining > 0) {
          budgetAlert = `\n💡 *Sisa kuota makanan:* ${formatRupiah(budgetStatus.remaining)} (Jatah aman: ${formatRupiah(budgetStatus.dailyAllowance)}/hari, sisa ${budgetStatus.daysRemaining} hari lagi)\n`;
        } else if (tx.category === 'Rokok & Vape' && budgetStatus.remaining > 0) {
          budgetAlert = `\n🚬 *Sisa kuota rokok & vape:* ${formatRupiah(budgetStatus.remaining)} dari limit ${formatRupiah(budgetStatus.monthlyLimit)}\n`;
        }
      }
    }

    // Label sumber bank
    let sourceLabel = 'Email Notifikasi QRIS / Bank';
    if (source === 'email_bank_jago' || bankName === 'Bank Jago') {
      sourceLabel = 'Bank Jago (Notifikasi Email)';
    } else if (bankName) {
      sourceLabel = `${bankName} (Notifikasi Email)`;
    }

    const icon = tx.type === 'income' ? '💰' : '💸';
    const label = tx.type === 'income' ? 'Pemasukan' : 'Pengeluaran';

    // Kirim notifikasi proaktif ke WhatsApp pengguna!
    const recipient = `${userNumber}@s.whatsapp.net`;
    const notificationText =
      `🔔 *Notifikasi Transaksi Baru Terdeteksi!*\n\n` +
      `💳 *Sumber:* ${sourceLabel}\n` +
      `🏪 *Tujuan / Merchant:* ${merchantName || '-'}\n` +
      `${icon} *Nominal:* ${formatRupiah(tx.amount)} (${label})\n` +
      `🏷️ *Kategori Kantong:* ${tx.category}\n` +
      `📝 *Keterangan:* ${tx.description}\n` +
      `🕒 *Waktu:* ${dayjs(tx.createdAt).format('DD/MM/YYYY HH:mm')}\n` +
      budgetAlert +
      `\n_Otomatis tercatat ke pembukuan Anda. Ketik *budget* atau *rekap* untuk melihat status saldo._`;

    await sendWhatsAppMessage(recipient, notificationText);

    res.status(201).json({ success: true, transaction: tx });
  } catch (err) {
    console.error('Error saat menyimpan transaksi:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /transactions
router.get('/', async (req, res) => {
  try {
    const { limit = 50, type, category } = req.query;
    const where = {};
    if (type) where.type = type;
    if (category) where.category = category;

    const list = await prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit, 10),
    });

    res.json({ success: true, count: list.length, data: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /transactions/summary
router.get('/summary', async (req, res) => {
  try {
    const transactions = await prisma.transaction.findMany();
    let totalIncome = 0;
    let totalExpense = 0;

    transactions.forEach((t) => {
      if (t.type === 'income') totalIncome += t.amount;
      else totalExpense += t.amount;
    });

    res.json({
      success: true,
      totalIncome,
      totalExpense,
      balance: totalIncome - totalExpense,
      totalCount: transactions.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
