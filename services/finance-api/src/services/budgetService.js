const prisma = require('../db');
const dayjs = require('dayjs');

// Total Anggaran Bulanan: Rp 4.500.000 (Gaji Tgl 21: 4jt + Booster Tgl 1: 500k)
const DEFAULT_BUDGETS = {
  'Makanan & Minuman': 1400000,
  'Rokok & Vape': 400000,
  'Bensin & Transportasi': 200000,
  'Kuota & Internet': 100000,
  'Listrik, Air & Wifi': 400000,
  'Belanja Bulanan': 400000,
  'Dana Darurat': 500000,
  'Tabungan': 300000,
  'Nongkrong & Hiburan': 400000,
  'Kirim Keluarga': 400000,
};

function formatRupiah(number) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(number);
}

function renderProgressBar(percentage, length = 10) {
  const clamped = Math.max(0, Math.min(100, percentage));
  const filledCount = Math.round((clamped / 100) * length);
  const emptyCount = length - filledCount;
  return '█'.repeat(filledCount) + '░'.repeat(emptyCount);
}

/**
 * Menghitung rentang siklus keuangan (Tgl 21 s/d Tgl 20 bulan berikutnya)
 */
function getPayCycleRange(targetDate = dayjs()) {
  const d = dayjs(targetDate);
  const day = d.date();
  let start;
  let end;

  if (day >= 21) {
    // Tanggal 21 s/d akhir bulan: siklus mulai tgl 21 bulan ini sampai tgl 20 bulan depan
    start = d.date(21).startOf('day');
    end = d.add(1, 'month').date(20).endOf('day');
  } else {
    // Tanggal 1 s/d 20: siklus mulai tgl 21 bulan lalu sampai tgl 20 bulan ini
    start = d.subtract(1, 'month').date(21).startOf('day');
    end = d.date(20).endOf('day');
  }

  const todayEnd = d.endOf('day');
  const daysRemaining = Math.max(1, Math.ceil(end.diff(todayEnd, 'day', true)) + 1);
  const totalDays = Math.round(end.diff(start, 'day', true)) + 1;
  const daysPassed = Math.max(1, totalDays - daysRemaining + 1);
  const nextPayday = day >= 21 ? d.add(1, 'month').date(21) : d.date(21);

  return {
    start: start.toDate(),
    end: end.toDate(),
    label: `${start.format('DD MMM')} – ${end.format('DD MMM YYYY')}`,
    nextPaydayFormatted: nextPayday.format('DD MMMM YYYY'),
    daysRemaining,
    totalDays,
    daysPassed,
  };
}

async function ensureDefaultBudgets(userNumber) {
  const existing = await prisma.budget.findMany({
    where: { userNumber },
  });

  const existingCategories = new Set(existing.map((b) => b.category));

  for (const [category, limit] of Object.entries(DEFAULT_BUDGETS)) {
    if (!existingCategories.has(category)) {
      await prisma.budget.create({
        data: {
          userNumber,
          category,
          monthlyLimit: limit,
        },
      });
    }
  }
}

async function syncDefaultBudgets(userNumber) {
  for (const [category, limit] of Object.entries(DEFAULT_BUDGETS)) {
    await prisma.budget.upsert({
      where: {
        userNumber_category: {
          userNumber,
          category,
        },
      },
      update: {
        monthlyLimit: limit,
      },
      create: {
        userNumber,
        category,
        monthlyLimit: limit,
      },
    });
  }
}

async function checkBudgetStatus(userNumber, category) {
  await ensureDefaultBudgets(userNumber);

  const budget = await prisma.budget.findUnique({
    where: {
      userNumber_category: {
        userNumber,
        category,
      },
    },
  });

  if (!budget || budget.monthlyLimit <= 0) {
    return { hasBudget: false };
  }

  const cycle = getPayCycleRange();

  const transactions = await prisma.transaction.findMany({
    where: {
      userNumber,
      category,
      type: 'expense',
      createdAt: { gte: cycle.start, lte: cycle.end },
    },
  });

  const totalSpent = transactions.reduce((acc, t) => acc + t.amount, 0);
  const percentage = Math.round((totalSpent / budget.monthlyLimit) * 100);
  const remaining = budget.monthlyLimit - totalSpent;
  const dailyAllowance = remaining > 0 ? Math.round(remaining / cycle.daysRemaining) : 0;

  return {
    hasBudget: true,
    category,
    monthlyLimit: budget.monthlyLimit,
    totalSpent,
    remaining,
    percentage,
    daysRemaining: cycle.daysRemaining,
    dailyAllowance,
    cycleLabel: cycle.label,
    isWarning: percentage >= 80 && percentage < 100,
    isOverbudget: percentage >= 100,
  };
}

async function generateBudgetReport(userNumber) {
  await ensureDefaultBudgets(userNumber);

  const cycle = getPayCycleRange();

  const budgets = await prisma.budget.findMany({
    where: { userNumber },
    orderBy: { monthlyLimit: 'desc' },
  });

  const transactions = await prisma.transaction.findMany({
    where: {
      userNumber,
      type: 'expense',
      createdAt: { gte: cycle.start, lte: cycle.end },
    },
  });

  const spentMap = {};
  transactions.forEach((t) => {
    spentMap[t.category] = (spentMap[t.category] || 0) + t.amount;
  });

  let totalLimit = 0;
  let totalSpent = 0;
  let reportItems = [];

  budgets.forEach((b) => {
    const spent = spentMap[b.category] || 0;
    totalLimit += b.monthlyLimit;
    totalSpent += spent;

    const pct = Math.round((spent / b.monthlyLimit) * 100);
    const bar = renderProgressBar(pct, 10);
    const sisa = b.monthlyLimit - spent;

    let statusEmoji = '🟢';
    if (pct >= 100) statusEmoji = '🚨';
    else if (pct >= 80) statusEmoji = '⚠️';

    let extraNote = '';
    if (b.category === 'Makanan & Minuman' && sisa > 0) {
      const daily = Math.round(sisa / cycle.daysRemaining);
      extraNote = `\n   🍚 _Jatah aman: ${formatRupiah(daily)}/hari_`;
    }

    reportItems.push(
      `${statusEmoji} *${b.category}*\n` +
      `[${bar}] ${pct}%\n` +
      `Terpakai: ${formatRupiah(spent)} / ${formatRupiah(b.monthlyLimit)}\n` +
      `Sisa: ${sisa >= 0 ? formatRupiah(sisa) : `-${formatRupiah(Math.abs(sisa))} (Over)`}` +
      extraNote
    );
  });

  const overallPct = totalLimit > 0 ? Math.round((totalSpent / totalLimit) * 100) : 0;
  const overallBar = renderProgressBar(overallPct, 12);

  const message =
    `🎯 *STATUS ANGGARAN SIKLUS GAJIAN*\n` +
    `🗓️ *Periode:* ${cycle.label}\n` +
    `⏳ *Hari ke-${cycle.daysPassed} dari ${cycle.totalDays}* (Sisa ${cycle.daysRemaining} hari menuju gajian)\n\n` +
    reportItems.join('\n\n') +
    `\n\n═══════════════════════\n` +
    `📊 *TOTAL KESELURUHAN SIKLUS:*\n` +
    `[${overallBar}] ${overallPct}%\n` +
    `💸 *Total Terpakai:* ${formatRupiah(totalSpent)}\n` +
    `🎯 *Batas Anggaran:* ${formatRupiah(totalLimit)}\n` +
    `💰 *Sisa Alokasi:* ${formatRupiah(totalLimit - totalSpent)}\n\n` +
    `_Tips: Ketik \`alokasi\` untuk panduan pembagian gaji tgl 21 & 1, atau \`set budget [kategori] [nominal]\`._`;

  return message;
}

async function updateCategoryBudget(userNumber, categoryName, newLimit) {
  return await prisma.budget.upsert({
    where: {
      userNumber_category: {
        userNumber,
        category: categoryName,
      },
    },
    update: {
      monthlyLimit: parseFloat(newLimit),
    },
    create: {
      userNumber,
      category: categoryName,
      monthlyLimit: parseFloat(newLimit),
    },
  });
}

function getDualCycleGuide() {
  const cycle = getPayCycleRange();

  return (
    `📋 *STRATEGI & PANDUAN DUA SIKLUS GAJI*\n` +
    `🗓️ *Siklus Aktif:* ${cycle.label}\n` +
    `⏳ *Sisa Waktu:* ${cycle.daysRemaining} hari lagi menuju gajian ${cycle.nextPaydayFormatted}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 *1. TANGGAL 21 — MASUK RP 4.000.000*\n` +
    `_Fase Kebutuhan Pokok, Kewajiban & Tabungan:_\n` +
    `• 🔒 *Tabungan & Investasi:* Rp 300.000 (Langsung pisahkan)\n` +
    `• 🛡️ *Dana Darurat:* Rp 500.000 (Kunci di bank digital)\n` +
    `• 👨‍👩‍👧 *Kirim Keluarga:* Rp 400.000\n` +
    `• 💡 *Listrik, Air & Wifi:* Rp 400.000 (Bayar tagihan)\n` +
    `• 🛒 *Belanja Bulanan:* Rp 400.000 (Sabun & sembako)\n` +
    `• 📶 *Kuota & Internet:* Rp 100.000\n` +
    `• ☕ *Nongkrong & Hiburan:* Rp 400.000\n` +
    `• 🍚 *Uang Makan Fase 1 (Tgl 21-31):* Rp 1.100.000 (Jatah ~Rp 100.000/hari)\n` +
    `• 🚬 *Rokok & Vape:* Rp 400.000 (Jatah 1 bulan penuh)\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💵 *2. TANGGAL 1 — MASUK RP 500.000*\n` +
    `_Fase Penguat Operasional (Tgl 1 s/d 20):_\n` +
    `• ⛽ *Bensin & Transportasi:* Rp 200.000\n` +
    `• 🍚 *Tambahan Uang Makan Fase 2:* Rp 300.000 (Melengkapi total makan jadi Rp 1.400.000)\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🤖 *AUTOMATION BOT:*\n` +
    `• Setiap Tgl 21 jam 08:00 bot otomatis catat +Rp 4.000.000\n` +
    `• Setiap Tgl 1 jam 08:00 bot otomatis catat +Rp 500.000\n` +
    `• Ketik \`simulasi gaji 21\` untuk uji coba catat gaji 4jt sekarang\n` +
    `• Ketik \`simulasi gaji 1\` untuk uji coba catat booster 500k sekarang\n` +
    `• Ketik \`budget\` untuk melihat sisa kuota dan jatah harian.`
  );
}

module.exports = {
  DEFAULT_BUDGETS,
  ensureDefaultBudgets,
  syncDefaultBudgets,
  checkBudgetStatus,
  generateBudgetReport,
  updateCategoryBudget,
  getPayCycleRange,
  getDualCycleGuide,
  formatRupiah,
};
