const express = require('express');
const router = express.Router();
const prisma = require('../db');
const { sendWhatsAppMessage } = require('../services/waClient');
const dayjs = require('dayjs');

function formatRupiah(number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(number);
}

function getDefaultUserNumber() {
  const allowed = process.env.ALLOWED_NUMBERS || '';
  const first = allowed.split(',')[0]?.trim().replace(/[^0-9]/g, '');
  return first || 'default_user';
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
      category = 'Pembayaran QRIS / Bank',
      notificationRaw,
      userNumber = getDefaultUserNumber(),
    } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Nominal amount wajib diisi dan harus > 0' });
    }

    const tx = await prisma.transaction.create({
      data: {
        userNumber,
        type,
        source,
        amount: parseFloat(amount),
        description: description || 'Transaksi Otomatis',
        category,
        merchantName: merchantName || null,
        notificationRaw: notificationRaw || null,
      },
    });

    console.log(`[Transactions] Transaksi baru tersimpan ID: ${tx.id} dari ${source}`);

    // Kirim notifikasi proaktif ke WhatsApp pengguna!
    const recipient = `${userNumber}@s.whatsapp.net`;
    const notificationText =
      `🔔 *Notifikasi Transaksi Baru Terdeteksi!*\n\n` +
      `💳 *Sumber:* ${source === 'email_qris' ? 'Email Notifikasi QRIS / Bank' : source}\n` +
      `🏪 *Merchant:* ${merchantName || '-'}\n` +
      `💵 *Nominal:* ${formatRupiah(tx.amount)}\n` +
      `🏷️ *Kategori:* ${tx.category}\n` +
      `📝 *Keterangan:* ${tx.description}\n` +
      `🕒 *Waktu:* ${dayjs(tx.createdAt).format('DD/MM/YYYY HH:mm')}\n\n` +
      `_Otomatis tercatat ke pembukuan Anda. Ketik *rekap* untuk melihat total saldo._`;

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
