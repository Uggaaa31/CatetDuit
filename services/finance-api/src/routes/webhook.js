const express = require('express');
const router = express.Router();
const prisma = require('../db');
const { parseMessage } = require('../services/nlpParser');
const { sendWhatsAppMessage, sendWhatsAppDocument } = require('../services/waClient');
const { extractReceiptData } = require('../services/ocrClient');
const { generateFinancialExcel } = require('../services/excelService');
const dayjs = require('dayjs');

function formatRupiah(number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(number);
}

function getPeriodRange(period) {
  const now = dayjs();
  let start;
  let label;

  if (period === 'month') {
    start = now.startOf('month');
    label = `Bulan Ini (${now.format('MMMM YYYY')})`;
  } else if (period === 'week') {
    start = now.startOf('week');
    label = 'Minggu Ini';
  } else if (period === 'yesterday') {
    start = now.subtract(1, 'day').startOf('day');
    label = `Kemarin (${now.subtract(1, 'day').format('DD/MM/YYYY')})`;
  } else {
    start = now.startOf('day');
    label = `Hari Ini (${now.format('DD/MM/YYYY')})`;
  }

  return {
    start: start.toDate(),
    label,
  };
}

router.post('/webhook', async (req, res) => {
  const { from, senderName, text, hasImage, imageFilePath } = req.body;
  if (!from) return res.status(400).json({ error: 'Missing "from" sender' });

  // Acknowledge webhook immediately to avoid timeout
  res.json({ received: true });

  const userNumber = from.replace(/[^0-9]/g, '');

  try {
    // 1. JIKA PESAN BERUPA FOTO STRUK
    if (hasImage && imageFilePath) {
      await sendWhatsAppMessage(
        from,
        '🔍 *Sedang membaca struk belanja Anda...*\nMohon tunggu beberapa detik.'
      );

      try {
        const ocrResult = await extractReceiptData(imageFilePath);
        const { merchantName, totalAmount, date, items, category } = ocrResult;

        if (!totalAmount || totalAmount <= 0) {
          return await sendWhatsAppMessage(
            from,
            '⚠️ Maaf, total nominal pada struk tidak terbaca jelas. Silakan catat manual, contoh: `indomaret 45rb`'
          );
        }

        let description = merchantName || 'Belanja Struk';
        let itemListText = '';

        if (items && items.length > 0) {
          description = items.map((i) => `${i.qty > 1 ? `${i.qty}x ` : ''}${i.name} (Rp ${formatRupiah(i.price)})`).join(', ');
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
            type: 'expense',
            source: 'ocr',
            amount: parseFloat(totalAmount),
            description,
            category: category || 'Kebutuhan Harian',
            merchantName: merchantName || null,
            receiptImageUrl: imageFilePath,
          },
        });

        const reply =
          `🧾 *Struk Berhasil Dicatat!*\n\n` +
          `🏪 *Toko/Merchant:* ${merchantName || '-'}\n` +
          `💵 *Total:* ${formatRupiah(tx.amount)}\n` +
          `🏷️ *Kategori:* ${tx.category}\n` +
          `📅 *Tanggal:* ${date || dayjs().format('DD/MM/YYYY')}\n` +
          itemListText +
          `\n_Ketik *batal* jika ingin membatalkan catatan ini._`;

        return await sendWhatsAppMessage(from, reply);
      } catch (ocrErr) {
        console.error('Error saat OCR struk:', ocrErr);
        return await sendWhatsAppMessage(
          from,
          `⚠️ Gagal memproses struk: ${ocrErr.message || 'Error OCR'}. Anda bisa mencatat manual: ketik misalnya \`indomaret 45rb\``
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
          `*1. Catat Pengeluaran:*
• \`makan siang 35rb\`
• \`kopi 25k\`
• \`bensin 50000\`
• \`pulsa 100rb\`

*2. Catat Pemasukan:*
• \`+gaji 6.5jt\`
• \`+pemasukan 500rb freelance\`

*3. Kirim Foto Struk:*
• Cukup kirim foto struk belanja, bot akan otomatis mengekstrak nominal & merchant!

*4. Cek Rekap & Laporan:*
• \`rekap\` (rekap hari ini)
• \`rekap minggu ini\`
• \`rekap bulan ini\`

*5. Batalkan Catatan Terakhir:*
• Ketik \`batal\` atau \`hapus\`

*6. Ekspor Data ke Excel:*
• Ketik \`export excel\` atau \`ekspor\``;

        return await sendWhatsAppMessage(from, helpMessage);
      }

      // 2b. REKAP LAPORAN
      if (parsed.action === 'rekap') {
        const { start, label } = getPeriodRange(parsed.period);

        const transactions = await prisma.transaction.findMany({
          where: {
            userNumber,
            createdAt: { gte: start },
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
          `\n\n_Ketik 'export excel' untuk mengunduh laporan detail._`;

        return await sendWhatsAppMessage(from, report);
      }

      // 2c. BATAL / UNDO TERAKHIR
      if (parsed.action === 'undo') {
        const lastTx = await prisma.transaction.findFirst({
          where: { userNumber },
          orderBy: { createdAt: 'desc' },
        });

        if (!lastTx) {
          return await sendWhatsAppMessage(from, 'ℹ️ Tidak ada transaksi untuk dibatalkan.');
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

      // 2d. EKSPOR EXCEL
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

    // 3. JIKA TRANSAKSI REGULER (makan 25rb, +gaji 5jt, dll.)
    if (parsed.isTransaction && parsed.data) {
      const { type, amount, description, category, merchantName, source } = parsed.data;

      const tx = await prisma.transaction.create({
        data: {
          userNumber,
          type,
          amount,
          description,
          category,
          merchantName: merchantName || null,
          source,
        },
      });

      const icon = type === 'income' ? '💰' : '💸';
      const label = type === 'income' ? 'Pemasukan' : 'Pengeluaran';

      let reply =
        `✅ *${label} Berhasil Dicatat!*\n\n` +
        `${icon} *Nominal:* ${formatRupiah(tx.amount)}\n` +
        `🏷️ *Kategori:* ${tx.category}\n` +
        `📦 *Barang/Catatan:* ${tx.description}\n`;

      if (tx.merchantName) {
        reply += `🏪 *Toko/Merchant:* ${tx.merchantName}\n`;
      }

      reply += `\n_Ketik *batal* jika salah catat, atau *rekap* untuk melihat saldo._`;

      return await sendWhatsAppMessage(from, reply);
    }

    // 4. PESAN TIDAK DIKENALI
    const unknownReply =
      `Halo *${senderName}*! Format pesan belum dikenali.\n\n` +
      `Contoh cepat:\n` +
      `• \`makan 25rb\`\n` +
      `• \`+gaji 5jt\`\n` +
      `• Kirim foto struk belanja\n\n` +
      `Ketik *bantuan* untuk melihat semua menu.`;

    await sendWhatsAppMessage(from, unknownReply);
  } catch (err) {
    console.error('Error handling webhook:', err);
    await sendWhatsAppMessage(from, `⚠️ Terjadi kesalahan: ${err.message}`);
  }
});

module.exports = router;
