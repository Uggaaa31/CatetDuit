const prisma = require('../db');
const dayjs = require('dayjs');
const { getPayCycleRange, formatRupiah, checkBudgetStatus } = require('./budgetService');
const { sendWhatsAppMessage } = require('./waClient');
const { detectCategory } = require('./nlpParser');
const { generateNightlyInsight, generateWeeklyInsight, collectInsightData } = require('./insightService');
const {
  BOT_NUMBERS,
  LID_ALIASES,
  isRealPhoneNumber,
  normalizePhoneNumber,
  getPrimaryUserNumber,
} = require('../config');

const sentNightlyReminders = new Set();
const sentAllocationReminders22 = new Set();
const sentBillReminders = new Set();
const sentWeeklyInsights = new Set();

/**
 * Otomatis konsolidasi data transaksi yang tersimpan di bawah LID ke nomor HP utama
 */
async function consolidateLidRecords() {
  try {
    const canonical = getPrimaryUserNumber();
    if (!canonical) {
      console.warn('[scheduler] Konsolidasi LID dilewati: PRIMARY_USER_NUMBER belum diset.');
      return;
    }
    if (LID_ALIASES.length === 0) {
      return;
    }

    const result = await prisma.transaction.updateMany({
      where: {
        userNumber: {
          in: LID_ALIASES,
        },
      },
      data: {
        userNumber: canonical,
      },
    });
    if (result.count > 0) {
      console.log(`[scheduler] Berhasil mengonsolidasi ${result.count} transaksi dari LID ke nomor telepon utama`);
    }

    // Bersihkan budget duplikat LID jika ada
    await prisma.budget.deleteMany({
      where: {
        userNumber: {
          in: LID_ALIASES,
        },
      },
    });

    // Otomatis sesuaikan budget Makanan & Minuman ke batas baru Rp 1.500.000
    await prisma.budget.updateMany({
      where: {
        category: 'Makanan & Minuman',
        monthlyLimit: 1400000,
      },
      data: {
        monthlyLimit: 1500000,
      },
    });

    // Otomatis update transaksi gaji 21 hari ini jika sebelumnya tercatat 4jt
    const cycle = getPayCycleRange();
    await prisma.transaction.updateMany({
      where: {
        source: 'auto_salary_21',
        amount: 4000000,
        createdAt: { gte: cycle.start, lte: cycle.end },
      },
      data: {
        amount: 4100000,
      },
    });

    // Otomatis reklasifikasi transaksi lama yang sempat masuk ke 'Lain-lain' ke 10 kantong resmi
    const lainLainTxs = await prisma.transaction.findMany({
      where: { category: 'Lain-lain' },
    });
    for (const tx of lainLainTxs) {
      const fixedCat = detectCategory(tx.description, tx.type, tx.amount);
      await prisma.transaction.update({
        where: { id: tx.id },
        data: { category: fixedCat },
      });
    }
    if (lainLainTxs.length > 0) {
      console.log(`[scheduler] Berhasil mereklasifikasi ${lainLainTxs.length} transaksi dari 'Lain-lain' ke kategori resmi.`);
    }
  } catch (err) {
    console.warn('[scheduler] Catatan migrasi LID DB:', err.message);
  }
}

/**
 * Mendapatkan daftar user WhatsApp aktif untuk dikirimi notifikasi automasi
 * HANYA nomor HP valid (@s.whatsapp.net), TIDAK PERNAH mengirim pesan terjadwal ke @lid
 */
async function getTargetUserNumbers() {
  const targets = new Set();

  // 1. Ambil nomor dari ALLOWED_NUMBERS env (hanya nomor HP valid, bukan LID / BOT)
  const allowed = (process.env.ALLOWED_NUMBERS || '')
    .split(',')
    .map((n) => n.trim().replace(/[^0-9]/g, ''))
    .filter((n) => isRealPhoneNumber(n) && !BOT_NUMBERS.includes(n))
    .map(normalizePhoneNumber);

  allowed.forEach((n) => targets.add(n));

  // 2. Ambil dari DB hanya jika berupa nomor HP valid
  try {
    const txUsers = await prisma.transaction.findMany({
      select: { userNumber: true },
      distinct: ['userNumber'],
    });
    txUsers.forEach((u) => {
      if (u.userNumber && isRealPhoneNumber(u.userNumber) && !BOT_NUMBERS.includes(u.userNumber)) {
        targets.add(normalizePhoneNumber(u.userNumber));
      }
    });

    const budgetUsers = await prisma.budget.findMany({
      select: { userNumber: true },
      distinct: ['userNumber'],
    });
    budgetUsers.forEach((b) => {
      if (b.userNumber && isRealPhoneNumber(b.userNumber) && !BOT_NUMBERS.includes(b.userNumber)) {
        targets.add(normalizePhoneNumber(b.userNumber));
      }
    });
  } catch (err) {
    console.error('[scheduler] Gagal mengambil nomor dari DB:', err.message);
  }

  // 3. Fallback ke nomor pengguna utama dari env jika tidak ada target lain
  if (targets.size === 0) {
    const primary = getPrimaryUserNumber();
    if (primary) {
      targets.add(primary);
    }
  }

  return Array.from(targets);
}

/**
 * Eksekusi pencatatan otomatis Gaji Pokok Rp 4.000.000 pada Tanggal 21
 */
async function executeSalary21(userNumber, isManual = false) {
  const cycle = getPayCycleRange();

  if (!isManual) {
    // Cek apakah gaji siklus ini sudah pernah dicatat
    const existing = await prisma.transaction.findFirst({
      where: {
        userNumber,
        type: 'income',
        source: 'auto_salary_21',
        createdAt: { gte: cycle.start, lte: cycle.end },
      },
    });

    if (existing) {
      console.log(`[scheduler] Gaji 21 siklus ${cycle.label} sudah dicatat untuk ${userNumber}. Dilewati.`);
      return { success: false, reason: 'already_recorded' };
    }
  }

  const tx = await prisma.transaction.create({
    data: {
      userNumber,
      type: 'income',
      source: 'auto_salary_21',
      amount: 4100000,
      description: `Gaji Pokok Bulanan (${cycle.label})`,
      category: 'Gaji & Pemasukan',
    },
  });

  const message =
    `🎉 *GAJI UTAMA TELAH MASUK!*\n` +
    `• 💰 *Nominal:* ${formatRupiah(4100000)}\n` +
    `• 🗓️ *Periode:* ${cycle.label}\n\n` +
    `Pemasukan Rp 4.100.000 otomatis tercatat ke pembukuan.\n\n` +
    `📋 *Checklist Alokasi Hari Ini:*\n` +
    `1. 📈 Tabungan: Rp 300.000 (SeaBank)\n` +
    `2. 🛡️ Dana Darurat: Rp 500.000 (SeaBank)\n` +
    `3. 👨‍👩‍👦 Kirim Keluarga: Rp 400.000 (Jago ➔ Ortu)\n` +
    `4. 💡 Listrik, Air & Wifi: Rp 400.000 (Jago ➔ Tagihan)\n` +
    `5. 🛒 Belanja Bulanan: Rp 400.000 (Jago)\n` +
    `6. 📶 Kuota & Internet: Rp 100.000 (Jago)\n` +
    `7. ☕ Nongkrong & Hiburan: Rp 400.000 (Jago)\n` +
    `8. 🍚 Uang Makan: Rp 1.200.000 (~Rp 50rb/hari)\n` +
    `9. 🚬 Rokok & Vape: Rp 400.000 (Jago)\n\n` +
    `_Ketik *budget* untuk pantau sisa kuota._`;

  try {
    await sendWhatsAppMessage(userNumber, message);
  } catch (err) {
    console.error(`[scheduler] Gagal kirim WA gaji 21 ke ${userNumber}:`, err.message);
  }

  return { success: true, tx };
}

/**
 * Pengingat Otomatis Pembagian Alokasi Perbankan (SeaBank & Bank Jago) setiap Tanggal 22 jam 08:00
 */
async function executeAllocationReminder22(userNumber, isManual = false) {
  const cycle = getPayCycleRange();

  const message =
    `📋 *PENGINGAT ALOKASI GAJI (TANGGAL 22)*\n` +
    `🗓️ *Siklus:* ${cycle.label}\n\n` +
    `Gaji Rp 4.100.000 kemarin (Tgl 21) sudah masuk di rekening *BSI*.\n` +
    `Hari ini saatnya memindahkan saldo ke *SeaBank* & *Bank Jago*:\n\n` +
    `═══════════════════════\n` +
    `*1. DARI BSI KE SEABANK (Total Rp 800.000)*\n` +
    `• 📈 Tabungan & Investasi: Rp 300.000\n` +
    `• 🛡️ Dana Darurat: Rp 500.000\n\n` +
    `═══════════════════════\n` +
    `*2. DARI BSI KE BANK JAGO (Total Rp 3.300.000)*\n` +
    `• 👨‍👩‍👦 Kirim Ortu: Rp 400.000\n` +
    `• 💡 Listrik, Air & Wifi: Rp 400.000\n` +
    `• 📶 Kuota & Internet: Rp 100.000\n` +
    `• 🛒 Belanja Sembako: Rp 400.000\n` +
    `• 🍚 Uang Makan: Rp 1.200.000 (~Rp 50rb/hari)\n` +
    `• 🚬 Rokok & Vape: Rp 400.000\n` +
    `• ☕ Nongkrong & Kopi: Rp 400.000\n\n` +
    `═══════════════════════\n` +
    `*Hasil Akhir:*\n` +
    `• Saldo BSI: Rp 0 (aman dari godaan belanja)\n` +
    `• Tagihan & ortu: langsung beres\n` +
    `• Uang makan & operasional: rapi di kantong Jago\n\n` +
    `_Ketik *budget* untuk pantau kuota._`;

  try {
    await sendWhatsAppMessage(userNumber, message);
  } catch (err) {
    console.error(`[scheduler] Gagal kirim pengingat alokasi 22 ke ${userNumber}:`, err.message);
  }

  return { success: true };
}

/**
 * Eksekusi pencatatan otomatis Dana Tambahan Rp 500.000 pada Tanggal 1
 */
async function executeBooster1(userNumber, isManual = false) {
  const startOfMonth = dayjs().startOf('month').toDate();
  const endOfMonth = dayjs().endOf('month').toDate();

  if (!isManual) {
    const existing = await prisma.transaction.findFirst({
      where: {
        userNumber,
        type: 'income',
        source: 'auto_salary_1',
        createdAt: { gte: startOfMonth, lte: endOfMonth },
      },
    });

    if (existing) {
      console.log(`[scheduler] Booster 1 bulan ini sudah dicatat untuk ${userNumber}. Dilewati.`);
      return { success: false, reason: 'already_recorded' };
    }
  }

  const tx = await prisma.transaction.create({
    data: {
      userNumber,
      type: 'income',
      source: 'auto_salary_1',
      amount: 500000,
      description: `Dana Tambahan / Booster Awal Bulan (Tgl 1)`,
      category: 'Gaji & Pemasukan',
    },
  });

  const cycle = getPayCycleRange();

  const message =
    `🎉 *DANA BOOSTER MASUK!*\n` +
    `• 💰 *Nominal:* ${formatRupiah(500000)}\n` +
    `• 🗓️ *Fase:* Pelumas Operasional Tgl 1 s/d 20\n\n` +
    `Pemasukan Rp 500.000 otomatis tercatat ke pembukuan.\n\n` +
    `📋 *Rekomendasi Alokasi:*\n` +
    `• ⛽ Bensin & Transportasi: Rp 200.000\n` +
    `• 🍚 Tambahan Uang Makan: Rp 300.000\n\n` +
    `⏳ Sisa ${cycle.daysRemaining} hari lagi menuju gajian ${cycle.nextPaydayFormatted}.\n` +
    `_Ketik *budget* untuk melihat sisa kuota._`;

  try {
    await sendWhatsAppMessage(userNumber, message);
  } catch (err) {
    console.error(`[scheduler] Gagal kirim WA booster 1 ke ${userNumber}:`, err.message);
  }

  return { success: true, tx };
}

/**
 * Pengingat Malam Hari Otomatis jam 22:30 (10.30 Malam)
 */
async function executeNightlyReminder(userNumber, isManual = false) {
  // Coba minta AI menulis rekapnya (lebih natural, angka tetap dari database).
  try {
    const ai = await generateNightlyInsight(userNumber, 'Bro');
    if (ai && ai.text) {
      const badge = isManual ? '_(Simulasi Pengingat Malam)_\n\n' : '';
      await sendWhatsAppMessage(userNumber, badge + ai.text);
      return { success: true, engine: ai.engine || 'ai' };
    }
  } catch (err) {
    console.warn('[scheduler] Insight malam via AI gagal, pakai template:', err.message);
  }

  const now = dayjs();
  const startOfDay = now.startOf('day').toDate();
  const endOfDay = now.endOf('day').toDate();

  const todayExpenses = await prisma.transaction.findMany({
    where: {
      userNumber,
      type: 'expense',
      createdAt: { gte: startOfDay, lte: endOfDay },
    },
    orderBy: { createdAt: 'asc' },
  });

  const cycle = getPayCycleRange(now);
  const foodStatus = await checkBudgetStatus(userNumber, 'Makanan & Minuman');

  let message = '';

  if (todayExpenses.length === 0) {
    message =
      `🌙 *Pengingat Malam (22:30)*\n\n` +
      `Hari ini belum ada catatan pengeluaran.\n` +
      `Ada jajan atau belanja yang belum tercatat?\n\n` +
      `📊 *Status Kuota Makanan:*\n` +
      `• Sisa Kuota: ${formatRupiah(foodStatus.remaining)}\n` +
      `• Jatah Aman Besok: ${formatRupiah(foodStatus.dailyAllowance)}/hari (sisa ${cycle.daysRemaining} hari)\n\n` +
      `_Selamat beristirahat! 💤_`;
  } else {
    let totalSpentToday = 0;
    const catMap = {};

    todayExpenses.forEach((t) => {
      totalSpentToday += t.amount;
      catMap[t.category] = (catMap[t.category] || 0) + t.amount;
    });

    let catLines = Object.entries(catMap)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, amt]) => `• ${cat}: ${formatRupiah(amt)}`)
      .join('\n');

    message =
      `🌙 *Rekap Pengeluaran Hari Ini (22:30)*\n\n` +
      `Tercatat *${todayExpenses.length} pengeluaran*:\n` +
      `• 💸 *Total Keluar:* ${formatRupiah(totalSpentToday)}\n\n` +
      `*Rincian:*\n` +
      `${catLines}\n\n` +
      `═══════════════════════\n` +
      `• 🍚 Sisa kuota makanan: ${formatRupiah(foodStatus.remaining)}\n` +
      `• ⏳ Jatah aman harian: ${formatRupiah(foodStatus.dailyAllowance)}/hari (sisa ${cycle.daysRemaining} hari)\n\n` +
      `_Selamat beristirahat! 💤_`;
  }

  try {
    await sendWhatsAppMessage(userNumber, message);
  } catch (err) {
    console.error(`[scheduler] Gagal kirim pengingat malam ke ${userNumber}:`, err.message);
  }

  return { success: true, count: todayExpenses.length };
}

/**
 * Insight mingguan: AI menulis ringkasan tren + saran, template sebagai cadangan.
 */
async function executeWeeklyInsight(userNumber, isManual = false) {
  const badge = isManual ? '_(Insight percobaan)_\n\n' : '';

  try {
    const ai = await generateWeeklyInsight(userNumber, 'Bro');
    if (ai && ai.text) {
      await sendWhatsAppMessage(userNumber, badge + ai.text);
      return { success: true, engine: ai.engine || 'ai' };
    }
  } catch (err) {
    console.warn('[scheduler] Insight mingguan via AI gagal, pakai template:', err.message);
  }

  // Cadangan: rangkuman dari angka database tanpa AI.
  try {
    const data = await collectInsightData(userNumber);
    const top = data.kategori_terboros;
    const anomalies = (data.anomali_kenaikan || [])
      .slice(0, 3)
      .map((a) => `• ${a.kategori}: naik ${a.kenaikan_persen}% (per hari ${formatRupiah(a.per_hari_sekarang)} vs ${formatRupiah(a.per_hari_siklus_lalu)})`)
      .join('\n');

    const message =
      `📊 *INSIGHT MINGGUAN*\n` +
      `🗓️ *Siklus:* ${data.periode_siklus} (sisa ${data.sisa_hari_ke_gajian} hari)\n\n` +
      `• 💸 *Pengeluaran siklus ini:* ${formatRupiah(data.total_pengeluaran_siklus)}\n` +
      `• 📉 *Siklus lalu:* ${formatRupiah(data.perbandingan_siklus_lalu.total_pengeluaran)}\n` +
      (top ? `• ⚠️ *Paling boros:* ${top.kategori} (${formatRupiah(top.nominal)})\n` : '') +
      (anomalies ? `\n⚠️ *Kenaikan mencolok:*\n${anomalies}\n` : '') +
      `\n_Ketik \`budget\` untuk rincian lengkap._`;

    await sendWhatsAppMessage(userNumber, badge + message);
    return { success: true, engine: 'template' };
  } catch (err) {
    console.error(`[scheduler] Gagal menyusun insight mingguan untuk ${userNumber}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Scheduler yang berjalan di background
 */
function startRecurringScheduler() {
  console.log('⏰ [scheduler] Layanan Automasi Gaji Terjadwal (Tgl 21 & Tgl 1) & Pengingat Malam (22:30) telah aktif.');

  // Jalankan konsolidasi LID ke nomor utama saat servis pertama menyala
  consolidateLidRecords();

  async function checkAndRun() {
    const now = dayjs();
    const date = now.date();
    const daysInMonth = now.daysInMonth();
    const hour = now.hour();
    const minute = now.minute();

    try {
      const users = await getTargetUserNumbers();

      // 1. Eksekusi Gaji Pokok (Tgl 21) & Booster (Tgl 1) jam 08:00 pagi
      if (hour >= 8) {
        if (date === 21) {
          for (const userNumber of users) {
            await executeSalary21(userNumber, false);
          }
        } else if (date === 1) {
          for (const userNumber of users) {
            await executeBooster1(userNumber, false);
          }
        }
      }

      // 2. Eksekusi Pengingat Alokasi Bank (SeaBank & Bank Jago) setiap Tgl 22 jam 08:00 pagi
      if (date === 22 && hour >= 8 && hour <= 10) {
        const todayStr = now.format('YYYY-MM-DD');
        for (const userNumber of users) {
          const key = `${userNumber}_alokasi_${todayStr}`;
          if (!sentAllocationReminders22.has(key)) {
            await executeAllocationReminder22(userNumber, false);
            sentAllocationReminders22.add(key);
          }
        }
      }

      // 2b. Eksekusi Pengingat Tagihan Rutin Jatuh Tempo setiap jam 09:00 pagi
      if (hour === 9 && minute <= 15) {
        const todayStr = now.format('YYYY-MM-DD');
        for (const userNumber of users) {
          const key = `${userNumber}_bills_${todayStr}`;
          if (!sentBillReminders.has(key)) {
            try {
              const dueBills = await prisma.bill.findMany({
                where: {
                  userNumber,
                  isActive: true,
                  dueDay: { in: [date, date >= daysInMonth ? 1 : date + 1] },
                },
              });

              if (dueBills.length > 0) {
                const billLines = dueBills
                  .map((b) => {
                    const timing = b.dueDay === date ? 'Hari Ini' : 'Besok';
                    const nominal = b.amount > 0 ? formatRupiah(b.amount) : 'nominal belum diisi';
                    return `• *${b.name}*: ${nominal} (Jatuh tempo *${timing}*)`;
                  })
                  .join('\n');

                const billAlert =
                  `⏰ *PENGINGAT JATUH TEMPO TAGIHAN*\n\n` +
                  billLines +
                  `\n\n_Ketik \`bayar tagihan [nama]\` untuk mencatat pelunasan._`;

                await sendWhatsAppMessage(userNumber, billAlert);
              }
            } catch (billErr) {
              console.error(`[scheduler] Error cek tagihan untuk ${userNumber}:`, billErr.message);
            }
            sentBillReminders.add(key);
          }
        }
      }

      // 2d. Insight mingguan setiap Minggu jam 20:00
      if (now.day() === 0 && hour === 20 && minute <= 15) {
        const todayStr = now.format('YYYY-MM-DD');
        for (const userNumber of users) {
          const key = `${userNumber}_weekly_${todayStr}`;
          if (!sentWeeklyInsights.has(key)) {
            await executeWeeklyInsight(userNumber, false);
            sentWeeklyInsights.add(key);
          }
        }
      }

      // 3. Eksekusi Pengingat Malam Hari Otomatis jam 22:30 malam (rentang 22:30 - 22:40)
      if (hour === 22 && minute >= 30 && minute <= 40) {
        const todayStr = now.format('YYYY-MM-DD');
        for (const userNumber of users) {
          const key = `${userNumber}_${todayStr}`;
          if (!sentNightlyReminders.has(key)) {
            await executeNightlyReminder(userNumber, false);
            sentNightlyReminders.add(key);
          }
        }
      }
    } catch (err) {
      console.error('[scheduler] Error running periodic check:', err.message);
    }
  }

  // Cek setiap 60 detik (1 menit) agar presisi pada 22:30
  setInterval(checkAndRun, 60 * 1000);

  // Jalankan cek pertama kali 5 detik setelah server start
  setTimeout(checkAndRun, 5000);
}

module.exports = {
  getTargetUserNumbers,
  consolidateLidRecords,
  executeSalary21,
  executeBooster1,
  executeNightlyReminder,
  executeAllocationReminder22,
  executeWeeklyInsight,
  startRecurringScheduler,
};
