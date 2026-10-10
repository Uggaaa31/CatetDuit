const express = require('express');
const router = express.Router();
const prisma = require('../db');
const { parseMessage } = require('../services/nlpParser');
const { sendWhatsAppMessage, sendWhatsAppDocument } = require('../services/waClient');
const { extractReceiptData } = require('../services/ocrClient');
const { generateFinancialExcel } = require('../services/excelService');
const {
  checkBudgetStatus,
  generateBudgetReport,
  updateCategoryBudget,
  syncDefaultBudgets,
  getPayCycleRange,
  getDualCycleGuide,
  DEFAULT_BUDGETS,
} = require('../services/budgetService');
const {
  executeSalary21,
  executeBooster1,
  executeNightlyReminder,
} = require('../services/schedulerService');
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

router.post('/webhook', async (req, res) => {
  const { from, senderName, text, hasImage, imageFilePath } = req.body;
  if (!from) return res.status(400).json({ error: 'Missing "from" sender' });

  // Acknowledge webhook immediately to avoid timeout
  res.json({ received: true });

  const userNumber = from.replace(/[^0-9]/g, '');

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
            .map((i) => `${i.qty > 1 ? `${i.qty}x ` : ''}${i.name} (Rp ${formatRupiah(i.price)})`)
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
            category: category || (transactionType === 'income' ? 'Gaji & Pemasukan' : 'Belanja Bulanan'),
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
              budgetAlert = `\n\n🚨 *PERINGATAN OVERBUDGET:* Pengeluaran '${tx.category}' sudah MELEBIHI batas! (Terpakai: ${formatRupiah(budgetStatus.totalSpent)} / Limit: ${formatRupiah(budgetStatus.monthlyLimit)})`;
            } else if (budgetStatus.isWarning) {
              budgetAlert = `\n\n⚠️ *Perhatian:* Pengeluaran '${tx.category}' sudah mencapai ${budgetStatus.percentage}% dari budget siklus ini (Sisa: ${formatRupiah(budgetStatus.remaining)})`;
            } else if (tx.category === 'Makanan & Minuman' && budgetStatus.remaining > 0) {
              budgetAlert = `\n\n💡 *Sisa kuota makanan:* ${formatRupiah(budgetStatus.remaining)} (Jatah aman: ${formatRupiah(budgetStatus.dailyAllowance)}/hari, sisa ${budgetStatus.daysRemaining} hari lagi)`;
            } else if (tx.category === 'Rokok & Vape' && budgetStatus.remaining > 0) {
              budgetAlert = `\n\n🚬 *Sisa kuota rokok & vape:* ${formatRupiah(budgetStatus.remaining)} dari limit ${formatRupiah(budgetStatus.monthlyLimit)}`;
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
• \`+gaji 4jt\`
• \`+pemasukan 500rb booster\`

*3. Kirim Foto Struk / M-Banking:*
• Kirim foto struk belanja atau bukti transfer m-banking, bot otomatis membaca nominal dan detailnya!

*4. Cek Alokasi Gaji & Anggaran:*
• \`alokasi\` (panduan alokasi gajian Tgl 21 & Tgl 1)
• \`budget\` (cek kuota & sisa hari dalam siklus gajian)
• \`set budget bensin 250rb\` (ubah limit anggaran)
• \`reset budget\` (kembalikan ke default Rp 4.500.000)

*5. Pengingat & Simulasi:*
• \`simulasi pengingat malam\` (tes notifikasi jam 22:30)
• \`simulasi gaji 21\` (tes pencatatan gaji pokok 4jt)
• \`simulasi gaji 1\` (tes pencatatan booster 500k)

*6. Cek Rekap & Laporan:*
• \`rekap\` (hari ini)
• \`rekap minggu ini\`
• \`rekap bulan ini\` (siklus gajian 21 s/d 20)

*7. Ekspor Excel & Batalkan:*
• \`export excel\` (unduh rekapan file Excel)
• \`batal\` (membatalkan transaksi terakhir)`;

        return await sendWhatsAppMessage(from, helpMessage);
      }

      // 2b. STATUS BUDGET SIKLUS GAJIAN
      if (parsed.action === 'budget') {
        const report = await generateBudgetReport(userNumber);
        return await sendWhatsAppMessage(from, report);
      }

      // 2c. PANDUAN DUA SIKLUS GAJI
      if (parsed.action === 'allocation_guide') {
        const guide = getDualCycleGuide();
        return await sendWhatsAppMessage(from, guide);
      }

      // 2d. SIMULASI / TRIGGER GAJI TGL 21 (4 JT)
      if (parsed.action === 'trigger_salary_21') {
        await sendWhatsAppMessage(from, '⏳ Memproses pencatatan/simulasi Gaji Pokok Tgl 21 (Rp 4.000.000)...');
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

      // 2g. RESET ANGGARAN KE STANDAR RP 4.500.000
      if (parsed.action === 'reset_budget') {
        await syncDefaultBudgets(userNumber);
        const reply =
          `✅ *Anggaran Berhasil Di-Reset ke Standar Alokasi!*\n\n` +
          `Total Anggaran: *Rp 4.500.000* (Gaji Pokok 4jt + Booster 500k).\n\n` +
          `_Ketik *budget* untuk melihat seluruh batas kuota._`;
        return await sendWhatsAppMessage(from, reply);
      }

      // 2h. UBAH LIMIT BUDGET
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

        // Cek apakah ada transaksi berdekatan (dalam selang 4 detik, batch multi-item)
        const recentTxs = await prisma.transaction.findMany({
          where: {
            userNumber,
            createdAt: {
              gte: new Date(lastTx.createdAt.getTime() - 4000),
              lte: new Date(lastTx.createdAt.getTime() + 1000),
            },
          },
          orderBy: { createdAt: 'desc' },
        });

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

    // 3. JIKA TRANSAKSI REGULER (Single Item atau Multi-Item Sekaligus)
    if (parsed.isTransaction) {
      const items = parsed.items || (parsed.data ? [parsed.data] : []);
      if (items.length === 0) return;

      // Kasus A: 1 Item Transaksi Tunggal
      if (items.length === 1) {
        const { type, amount, description, category, merchantName, source } = items[0];

        const tx = await prisma.transaction.create({
          data: {
            userNumber,
            type,
            amount,
            description,
            category,
            merchantName: merchantName || null,
            source: source || 'manual',
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

        // Cek Status Budget jika pengeluaran
        if (type === 'expense') {
          const budgetStatus = await checkBudgetStatus(userNumber, tx.category);
          if (budgetStatus.hasBudget) {
            if (budgetStatus.isOverbudget) {
              reply += `\n🚨 *PERINGATAN OVERBUDGET:* Pengeluaran '${tx.category}' sudah MELEBIHI batas! (Terpakai: ${formatRupiah(budgetStatus.totalSpent)} / Limit: ${formatRupiah(budgetStatus.monthlyLimit)})`;
            } else if (budgetStatus.isWarning) {
              reply += `\n⚠️ *Perhatian:* Pengeluaran '${tx.category}' sudah mencapai ${budgetStatus.percentage}% dari budget siklus ini (Sisa: ${formatRupiah(budgetStatus.remaining)})`;
            } else if (tx.category === 'Makanan & Minuman' && budgetStatus.remaining > 0) {
              reply += `\n💡 *Sisa kuota makanan:* ${formatRupiah(budgetStatus.remaining)} (Jatah aman: ${formatRupiah(budgetStatus.dailyAllowance)}/hari, sisa ${budgetStatus.daysRemaining} hari lagi)`;
            } else if (tx.category === 'Rokok & Vape' && budgetStatus.remaining > 0) {
              reply += `\n🚬 *Sisa kuota rokok & vape:* ${formatRupiah(budgetStatus.remaining)} dari limit ${formatRupiah(budgetStatus.monthlyLimit)}`;
            }
          }
        }

        reply += `\n\n_Ketik *batal* jika salah catat, atau *budget* untuk melihat sisa kuota._`;
        return await sendWhatsAppMessage(from, reply);
      }

      // Kasus B: Multi-Item Transaksi Sekaligus (contoh: "makan 25rb, es teh 5rb, parkir 2rb")
      let totalExpense = 0;
      let totalIncome = 0;
      const createdTxs = [];

      for (const item of items) {
        const tx = await prisma.transaction.create({
          data: {
            userNumber,
            type: item.type,
            amount: item.amount,
            description: item.description,
            category: item.category,
            merchantName: item.merchantName || null,
            source: 'manual_multi',
          },
        });
        createdTxs.push(tx);
        if (item.type === 'income') totalIncome += item.amount;
        else totalExpense += item.amount;
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

      // Cek status anggaran untuk kategori-kategori yang terpengaruh
      let budgetAlerts = [];
      const expenseCats = [...new Set(createdTxs.filter((t) => t.type === 'expense').map((t) => t.category))];
      for (const cat of expenseCats) {
        const budgetStatus = await checkBudgetStatus(userNumber, cat);
        if (budgetStatus.hasBudget) {
          if (budgetStatus.isOverbudget) {
            budgetAlerts.push(`🚨 *${cat}* MELEBIHI batas! (Sisa: ${formatRupiah(budgetStatus.remaining)})`);
          } else if (budgetStatus.isWarning) {
            budgetAlerts.push(`⚠️ *${cat}* sudah ${budgetStatus.percentage}% (Sisa: ${formatRupiah(budgetStatus.remaining)})`);
          } else if (cat === 'Makanan & Minuman' && budgetStatus.remaining > 0) {
            budgetAlerts.push(`💡 *Sisa kuota makanan:* ${formatRupiah(budgetStatus.remaining)} (Jatah aman: ${formatRupiah(budgetStatus.dailyAllowance)}/hari)`);
          } else if (cat === 'Rokok & Vape' && budgetStatus.remaining > 0) {
            budgetAlerts.push(`🚬 *Sisa kuota rokok & vape:* ${formatRupiah(budgetStatus.remaining)}`);
          }
        }
      }

      const alertBlock = budgetAlerts.length > 0 ? `\n${budgetAlerts.join('\n')}\n` : '';

      const reply =
        `✅ *${createdTxs.length} Transaksi Berhasil Dicatat Sekaligus!*\n\n` +
        itemListText +
        `═══════════════════════\n` +
        summaryText + '\n' +
        alertBlock +
        `\n_Ketik *batal* untuk membatalkan semua catatan ini sekaligus, atau *budget* untuk cek sisa kuota._`;

      return await sendWhatsAppMessage(from, reply);
    }

    // 4. PESAN TIDAK DIKENALI
    const unknownReply =
      `Halo *${senderName}*! Format pesan belum dikenali.\n\n` +
      `Contoh cepat:\n` +
      `• \`makan 25rb di warteg\`\n` +
      `• \`makan 25rb, es teh 5rb, parkir 2rb\` (catat banyak sekaligus)\n` +
      `• \`rokok surya 35rb di warung\`\n` +
      `• \`budget\` (cek kuota anggaran & sisa hari)\n` +
      `• \`alokasi\` (panduan pembagian gaji tgl 21 & 1)\n` +
      `• Kirim foto struk belanja / m-banking\n\n` +
      `Ketik *bantuan* untuk melihat semua menu.`;

    await sendWhatsAppMessage(from, unknownReply);
  } catch (err) {
    console.error('Error handling webhook:', err);
    await sendWhatsAppMessage(from, `⚠️ Terjadi kesalahan: ${err.message}`);
  }
});

module.exports = router;
