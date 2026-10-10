const prisma = require('../db');
const dayjs = require('dayjs');
const { getPayCycleRange, formatRupiah, checkBudgetStatus } = require('./budgetService');
const { sendWhatsAppMessage } = require('./waClient');

const BOT_NUMBERS = ['62881081881341', '227087872991280'];
const sentNightlyReminders = new Set();

/**
 * Mendapatkan daftar user WhatsApp aktif untuk dikirimi notifikasi automasi
 */
async function getTargetUserNumbers() {
  const targets = new Set();

  try {
    const txUsers = await prisma.transaction.findMany({
      select: { userNumber: true },
      distinct: ['userNumber'],
    });
    txUsers.forEach((u) => {
      if (u.userNumber && !BOT_NUMBERS.includes(u.userNumber)) {
        targets.add(u.userNumber);
      }
    });

    const budgetUsers = await prisma.budget.findMany({
      select: { userNumber: true },
      distinct: ['userNumber'],
    });
    budgetUsers.forEach((b) => {
      if (b.userNumber && !BOT_NUMBERS.includes(b.userNumber)) {
        targets.add(b.userNumber);
      }
    });
  } catch (err) {
    console.error('[scheduler] Gagal mengambil nomor dari DB:', err.message);
  }

  // Tambahkan nomor dari ALLOWED_NUMBERS env
  const allowed = (process.env.ALLOWED_NUMBERS || '')
    .split(',')
    .map((n) => n.trim().replace(/[^0-9]/g, ''))
    .filter((n) => n && !BOT_NUMBERS.includes(n));

  allowed.forEach((n) => targets.add(n));

  // Fallback default nomor pengguna utama jika env kosong
  if (targets.size === 0) {
    targets.add('6281341185188');
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
      amount: 4000000,
      description: `Gaji Pokok Bulanan (${cycle.label})`,
      category: 'Gaji & Pemasukan',
    },
  });

  const message =
    `🎉 *GAJIAN UTAMA TELAH MASUK!*\n` +
    `💰 *Nominal:* ${formatRupiah(4000000)}\n` +
    `🗓️ *${cycle.label}*\n\n` +
    `Bot telah otomatis mencatat pemasukan Rp 4.000.000 ke pembukuan Anda.\n\n` +
    `📋 *CHECKLIST ALOKASI HARI INI (Langsung Pisahkan!):*\n` +
    `1. 🔒 *Tabungan & Investasi:* Rp 300.000 (Pindah ke Bank Digital/Bibit)\n` +
    `2. 🛡️ *Dana Darurat:* Rp 500.000 (Kunci di kantong terkunci)\n` +
    `3. 👨‍👩‍👧 *Kirim Keluarga:* Rp 400.000 (Langsung transfer)\n` +
    `4. 💡 *Listrik, Air & Wifi:* Rp 400.000 (Bayar tagihan)\n` +
    `5. 🛒 *Belanja Bulanan:* Rp 400.000 (Kebutuhan pokok & rumah)\n` +
    `6. 📶 *Kuota & Internet:* Rp 100.000\n` +
    `7. ☕ *Nongkrong & Hiburan:* Rp 400.000\n` +
    `8. 🍚 *Uang Makan Fase 1 (Tgl 21-31):* Rp 1.100.000 (~Rp 100.000/hari)\n` +
    `9. 🚬 *Rokok & Vape:* Rp 400.000 (Jatah 1 bulan penuh)\n\n` +
    `💡 *Tips:* Amankan tabungan & bayar kewajiban di awal agar tidak habis terpakai!\n` +
    `_Ketik \`budget\` untuk pantau sisa kuota belanja Anda._`;

  try {
    await sendWhatsAppMessage(userNumber, message);
  } catch (err) {
    console.error(`[scheduler] Gagal kirim WA gaji 21 ke ${userNumber}:`, err.message);
  }

  return { success: true, tx };
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
    `💰 *DANA BOOSTER TELAH MASUK!*\n` +
    `💵 *Nominal:* ${formatRupiah(500000)}\n` +
    `🗓️ *Fase:* Pelumas Operasional Tgl 1 s/d 20\n\n` +
    `Bot telah otomatis mencatat pemasukan Rp 500.000 ke pembukuan.\n\n` +
    `📋 *REKOMENDASI ALOKASI:*` +
    `\n• ⛽ *Bensin & Transportasi:* Rp 200.000` +
    `\n• 🍚 *Tambahan Uang Makan Fase 2 (Tgl 1-20):* Rp 300.000\n\n` +
    `⏳ *Sisa ${cycle.daysRemaining} hari lagi menuju gajian ${cycle.nextPaydayFormatted}!*\n` +
    `_Ketik \`budget\` untuk melihat sisa kuota belanja Anda saat ini._`;

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
      `🌙 *Halo Bro! Pengingat Malam (22:30)*\n\n` +
      `Hari ini belum ada catatan pengeluaran sama sekali nih. 😉\n` +
      `Apakah hari ini memang hemat atau ada jajan/bensin yang kelupaan dicatat?\n\n` +
      `💡 *Tips Cepat:* Anda bisa mencatat banyak item sekaligus lho, contoh:\n` +
      `• \`makan 25rb, es teh 5rb, parkir 2rb\`\n` +
      `• \`bensin 50rb sama rokok 35rb di SPBU\`\n\n` +
      `📊 *Status Kuota Makanan Siklus Ini:*\n` +
      `• Sisa Kuota: ${formatRupiah(foodStatus.remaining)}\n` +
      `• Jatah Aman Esok Hari: ${formatRupiah(foodStatus.dailyAllowance)}/hari (sisa ${cycle.daysRemaining} hari lagi).\n\n` +
      `_Selamat beristirahat! 😴_`;
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
      `Hari ini Anda telah mencatat *${todayExpenses.length} pengeluaran*:\n` +
      `💸 *Total Keluar Hari Ini:* ${formatRupiah(totalSpentToday)}\n\n` +
      `📋 *Rincian Kategori:*\n` +
      `${catLines}\n\n` +
      `═══════════════════════\n` +
      `💡 *Info Esok Hari:*\n` +
      `🍚 Sisa kuota makanan: ${formatRupiah(foodStatus.remaining)}\n` +
      `⏳ Jatah aman harian: ${formatRupiah(foodStatus.dailyAllowance)}/hari (sisa ${cycle.daysRemaining} hari menuju gajian ${cycle.nextPaydayFormatted}).\n\n` +
      `_Selamat beristirahat! 😴_`;
  }

  try {
    await sendWhatsAppMessage(userNumber, message);
  } catch (err) {
    console.error(`[scheduler] Gagal kirim pengingat malam ke ${userNumber}:`, err.message);
  }

  return { success: true, count: todayExpenses.length };
}

/**
 * Scheduler yang berjalan di background
 */
function startRecurringScheduler() {
  console.log('⏰ [scheduler] Layanan Automasi Gaji Terjadwal (Tgl 21 & Tgl 1) & Pengingat Malam (22:30) telah aktif.');

  async function checkAndRun() {
    const now = dayjs();
    const date = now.date();
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

      // 2. Eksekusi Pengingat Malam Hari Otomatis jam 22:30 malam (rentang 22:30 - 22:40)
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
  executeSalary21,
  executeBooster1,
  executeNightlyReminder,
  startRecurringScheduler,
};
