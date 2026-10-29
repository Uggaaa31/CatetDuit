const express = require('express');
const router = express.Router();
const prisma = require('../db');
const { parseMessage, isConversationalText } = require('../services/nlpParser');
const { sendWhatsAppMessage, sendWhatsAppDocument } = require('../services/waClient');
const { extractReceiptData, parseChatWithAI } = require('../services/ocrClient');
const { generateFinancialExcel } = require('../services/excelService');
const {
  checkBudgetStatus,
  generateBudgetReport,
  updateCategoryBudget,
  syncDefaultBudgets,
  transferPocketBudget,
  getPayCycleRange,
  getDualCycleGuide,
  DEFAULT_BUDGETS,
} = require('../services/budgetService');
const {
  executeSalary21,
  executeBooster1,
  executeNightlyReminder,
  executeAllocationReminder22,
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

const { getCanonicalUserNumber } = require('../config');

function isAllowedSender(from) {
  if (!from) return false;
  // Tolak SEMUA pesan grup WhatsApp
  if (from.endsWith('@g.us') || from.includes('@g.us')) return false;

  const raw = process.env.ALLOWED_NUMBERS || '';
  const allowed = raw
    .split(',')
    .map((n) => n.trim().replace(/[^0-9]/g, ''))
    .filter(Boolean);

  if (allowed.length === 0) return false;
  if (allowed.includes('*')) return true;

  const clean = from.split('@')[0].replace(/[^0-9]/g, '');
  return allowed.includes(clean);
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

  if (items.length === 1) {
    const { type, amount, description, category, merchantName } = items[0];

    const tx = await prisma.transaction.create({
      data: {
        userNumber,
        type: type || 'expense',
        amount: parseFloat(amount) || 0,
        description: description || 'Pengeluaran',
        category: category || 'Makanan & Minuman',
        merchantName: merchantName || null,
        source: sourceLabel || 'manual',
      },
    });

    const icon = tx.type === 'income' ? '💰' : '💸';
    const label = tx.type === 'income' ? 'Pemasukan' : 'Pengeluaran';

    let reply =
      `✅ *${label} Berhasil Dicatat!*\n\n` +
      `${icon} *Nominal:* ${formatRupiah(tx.amount)}\n` +
      `🏷️ *Kategori:* ${tx.category}\n` +
      `📦 *Barang/Catatan:* ${tx.description}\n`;

    if (tx.merchantName) {
      reply += `🏪 *Toko/Merchant:* ${tx.merchantName}\n`;
    }

    if (tx.type === 'expense') {
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

    if (badgeText) {
      reply += `\n\n${badgeText}`;
    }

    reply += `\n\n_Ketik *batal* jika salah catat, atau *budget* untuk melihat sisa kuota._`;
    return await sendWhatsAppMessage(from, reply);
  }

  // Multi-item
  let totalExpense = 0;
  let totalIncome = 0;
  const createdTxs = [];

  for (const item of items) {
    const tx = await prisma.transaction.create({
      data: {
        userNumber,
        type: item.type || 'expense',
        amount: parseFloat(item.amount) || 0,
        description: item.description || 'Pengeluaran',
        category: item.category || 'Makanan & Minuman',
        merchantName: item.merchantName || null,
        source: sourceLabel || 'manual_multi',
      },
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
  const badgeBlock = badgeText ? `\n${badgeText}\n` : '';

  const reply =
    `✅ *${createdTxs.length} Transaksi Berhasil Dicatat Sekaligus!*\n\n` +
    itemListText +
    `═══════════════════════\n` +
    summaryText + '\n' +
    alertBlock +
    badgeBlock +
    `\n_Ketik *batal* untuk membatalkan semua catatan ini sekaligus, atau *budget* untuk cek sisa kuota._`;

  return await sendWhatsAppMessage(from, reply);
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
• \`+gaji 4.1jt\`
• \`+pemasukan 500rb booster\`

*3. Pindah Dana & Alokasi Rekening:*
• \`pindah 800rb ke seabank\` (otomatis masuk Tabungan & Darurat)
• \`pindah 3.3jt ke jago\` (pindah saldo operasional ke Bank Jago)
• \`pindah 400rb ke ortu\` (Kirim Keluarga via Bank Jago)
• \`13k pindahkan ke makanan dari uang bulanan\` (geser budget antar kantong)
• \`pindah dana\` (panduan pemindahan & alokasi saldo)

*4. Kirim Foto Struk / M-Banking:*
• Kirim foto struk belanja atau bukti transfer m-banking, bot otomatis membaca nominal dan detailnya!

*5. Cek Alokasi Gaji & Anggaran:*
• \`alokasi\` (panduan alokasi gajian Tgl 21 & Tgl 1)
• \`budget\` (cek kuota & sisa hari dalam siklus gajian)
• \`set budget bensin 250rb\` (ubah limit anggaran)
• \`reset budget\` (kembalikan ke default Rp 4.600.000)

*6. Pengingat & Simulasi:*
• \`simulasi pengingat malam\` (tes notifikasi jam 22:30)
• \`simulasi alokasi 22\` (tes reminder alokasi SeaBank & Jago Tgl 22)
• \`simulasi gaji 21\` (tes pencatatan gaji pokok 4,1jt)
• \`simulasi gaji 1\` (tes pencatatan booster 500k)

*7. Cek Rekap & Laporan:*
• \`rekap\` (hari ini)
• \`rekap minggu ini\`
• \`rekap bulan ini\` (siklus gajian 21 s/d 20)

*8. Ekspor Excel, Batal & Restart:*
• \`export excel\` (unduh rekapan file Excel)
• \`batal\` (membatalkan transaksi terakhir)
• \`restart keuangan\` (hapus semua transaksi & mulai dari nol)`;

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

      // 2g. RESTART / RESET SEMUA DATA KEUANGAN
      if (parsed.action === 'reset_all_data') {
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

    // 3. JIKA PESAN PERCAKAPAN ALAMI / BEBAS (CONVERSATIONAL TEXT)
    // Jika user chat santai, cerita panjang, gaul, atau tanya saran -> proses via Gemini AI
    const isConversational = isConversationalText(text);

    if (isConversational) {
      console.log(`[webhook] Teks terdeteksi percakapan bebas/santai. Memproses via Gemini AI: "${text}"`);
      const aiResult = await parseChatWithAI(text, senderName);

      if (aiResult) {
        // A. Transaksi Keuangan yang diekstrak oleh AI
        if (aiResult.isFinancial && aiResult.transactions && aiResult.transactions.length > 0) {
          return await executeTransactionsOperation(
            userNumber,
            from,
            aiResult.transactions,
            'gemini_chat',
            '🤖 _(Dianalisis & dicatat otomatis oleh Gemini AI)_'
          );
        }

        // B. Pemindahan Saldo / Transfer yang diekstrak oleh AI
        if (aiResult.isFinancial && aiResult.transfer && aiResult.transfer.isTransfer) {
          return await executeTransferOperation(userNumber, from, aiResult.transfer);
        }

        // B1. Pergeseran Anggaran Antar Kantong yang diekstrak oleh AI
        if (aiResult.isFinancial && aiResult.pocketShift && aiResult.pocketShift.isShift) {
          return await executePocketShiftOperation(userNumber, from, aiResult.pocketShift);
        }

        // C. Percakapan umum / Pertanyaan keuangan / Sapaan ramah
        if (aiResult.friendlyResponse) {
          return await sendWhatsAppMessage(from, aiResult.friendlyResponse);
        }
      }
    }

    // 4. JIKA BUKAN PERCAKAPAN BEBAS ATAU AI GAGAL / TIMEOUT:
    // Gunakan Rule-Based NLP Parser untuk transaksi cepat & terstruktur
    if (parsed.isPocketShift && parsed.data) {
      return await executePocketShiftOperation(userNumber, from, parsed.data);
    }

    if (parsed.isTransfer && parsed.data) {
      return await executeTransferOperation(userNumber, from, parsed.data);
    }

    if (parsed.isTransaction) {
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

    // 5. JIKA MASIH BELUM DIKENALI REGEX, COBA GEMINI AI SEBAGAI FALLBACK CERDAS
    if (!isConversational) {
      console.log(`[webhook] Mencoba fallback Gemini AI untuk teks tidak dikenal: "${text}"`);
      const aiResult = await parseChatWithAI(text, senderName);

      if (aiResult) {
        if (aiResult.isFinancial && aiResult.transactions && aiResult.transactions.length > 0) {
          return await executeTransactionsOperation(
            userNumber,
            from,
            aiResult.transactions,
            'gemini_chat',
            '🤖 _(Dianalisis & dicatat otomatis oleh Gemini AI)_'
          );
        }

        if (aiResult.isFinancial && aiResult.transfer && aiResult.transfer.isTransfer) {
          return await executeTransferOperation(userNumber, from, aiResult.transfer);
        }

        if (aiResult.isFinancial && aiResult.pocketShift && aiResult.pocketShift.isShift) {
          return await executePocketShiftOperation(userNumber, from, aiResult.pocketShift);
        }

        if (aiResult.friendlyResponse) {
          return await sendWhatsAppMessage(from, aiResult.friendlyResponse);
        }
      }
    }

    // 6. FORMAT PESAN TIDAK DIKENALI
    const unknownReply =
      `Halo *${senderName}*! Format pesan belum dikenali.\n\n` +
      `Contoh cepat:\n` +
      `• \`makan 25rb di warteg\`\n` +
      `• \`makan 25rb, es teh 5rb, parkir 2rb\` (catat banyak sekaligus)\n` +
      `• \`rokok surya 35rb di warung\`\n` +
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
