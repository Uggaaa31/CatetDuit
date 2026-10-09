const prisma = require('../db');
const dayjs = require('dayjs');
const { getPayCycleRange, formatRupiah } = require('./budgetService');
const { sendWhatsAppMessage } = require('./waClient');

const BOT_NUMBERS = ['62881081881341', '227087872991280'];

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
 * Scheduler yang berjalan di background
 */
function startRecurringScheduler() {
  console.log('⏰ [scheduler] Layanan Automasi Gaji Terjadwal (Tgl 21 & Tgl 1) telah aktif.');

  async function checkAndRun() {
    const now = dayjs();
    const date = now.date();
    const hour = now.hour();

    // Hanya picu setelah jam 08:00 pagi
    if (hour < 8) return;

    try {
      const users = await getTargetUserNumbers();

      if (date === 21) {
        for (const userNumber of users) {
          await executeSalary21(userNumber, false);
        }
      } else if (date === 1) {
        for (const userNumber of users) {
          await executeBooster1(userNumber, false);
        }
      }
    } catch (err) {
      console.error('[scheduler] Error running periodic check:', err.message);
    }
  }

  // Cek setiap 5 menit (300.000 ms)
  setInterval(checkAndRun, 5 * 60 * 1000);

  // Jalankan cek pertama kali 5 detik setelah server start
  setTimeout(checkAndRun, 5000);
}

module.exports = {
  getTargetUserNumbers,
  executeSalary21,
  executeBooster1,
  startRecurringScheduler,
};
