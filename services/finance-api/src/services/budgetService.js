const prisma = require('../db');
const dayjs = require('dayjs');

// Total Anggaran Bulanan: Rp 4.600.000 (Gaji Tgl 21: 4,1jt + Booster Tgl 1: 500k)
const DEFAULT_BUDGETS = {
  'Makanan & Minuman': 1500000,
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

const DAILY_CATEGORIES = new Set([
  'Makanan & Minuman',
  'Rokok & Vape',
  'Bensin & Transportasi',
  'Nongkrong & Hiburan',
  'Belanja Bulanan',
]);

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
  // Hitung selisih berdasarkan awal hari, bukan jam akhir hari, supaya jumlah hari
  // kalender siklus 21–20 tidak kelebihan 1 hari.
  const totalDays = end.startOf('day').diff(start.startOf('day'), 'day') + 1;
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

async function checkBudgetStatus(userNumber, category, targetDate = new Date()) {
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

  const cycle = getPayCycleRange(targetDate);
  const d = dayjs(targetDate);
  const startOfDay = d.startOf('day').toDate();
  const endOfDay = d.endOf('day').toDate();

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

  // Pemakaian khusus hari ini
  const todayTransactions = transactions.filter(
    (t) => t.createdAt >= startOfDay && t.createdAt <= endOfDay
  );
  const todaySpent = todayTransactions.reduce((acc, t) => acc + t.amount, 0);

  // Sisa kuota pada awal hari (sebelum belanja hari ini)
  const spentBeforeToday = transactions
    .filter((t) => t.createdAt < startOfDay)
    .reduce((acc, t) => acc + t.amount, 0);
  const remainingAtStartOfDay = budget.monthlyLimit - spentBeforeToday;

  // Jatah hari ini didasarkan pada sisa awal hari dibagi sisa hari siklus
  const todayDailyLimit =
    remainingAtStartOfDay > 0 ? Math.round(remainingAtStartOfDay / cycle.daysRemaining) : 0;

  // Sisa jatah khusus hari ini (setelah dipotong belanja hari ini)
  const todayDailyRemaining = todayDailyLimit - todaySpent;
  const isTodayOver = todayDailyRemaining < 0;

  // Proyeksi jatah harian mulai besok
  const daysAfterToday = Math.max(1, cycle.daysRemaining - 1);
  const nextDayAllowance = remaining > 0 ? Math.round(remaining / daysAfterToday) : 0;

  return {
    hasBudget: true,
    category,
    monthlyLimit: budget.monthlyLimit,
    totalSpent,
    remaining,
    percentage,
    daysRemaining: cycle.daysRemaining,
    dailyAllowance,
    todayDailyLimit,
    todaySpent,
    todayDailyRemaining,
    isTodayOver,
    nextDayAllowance,
    isDailyCategory: DAILY_CATEGORIES.has(category),
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

async function generateTodayBudgetReport(userNumber, targetCategory = null) {
  await ensureDefaultBudgets(userNumber);

  const cycle = getPayCycleRange();
  const d = dayjs();
  const startOfDay = d.startOf('day').toDate();
  const endOfDay = d.endOf('day').toDate();

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

  const resolvedCategory = targetCategory ? matchCategory(targetCategory) || targetCategory : null;

  if (resolvedCategory) {
    const b = budgets.find((item) => item.category.toLowerCase() === resolvedCategory.toLowerCase());
    if (!b) {
      return `❌ Kategori *${resolvedCategory}* tidak ditemukan dalam daftar anggaran Anda.\nKetik \`budget\` untuk melihat daftar kategori aktif.`;
    }

    const catTxs = transactions.filter((t) => t.category === b.category);
    const totalSpent = catTxs.reduce((acc, t) => acc + t.amount, 0);
    const spentToday = catTxs
      .filter((t) => t.createdAt >= startOfDay && t.createdAt <= endOfDay)
      .reduce((acc, t) => acc + t.amount, 0);
    const spentBeforeToday = catTxs
      .filter((t) => t.createdAt < startOfDay)
      .reduce((acc, t) => acc + t.amount, 0);

    const remainingAtStart = b.monthlyLimit - spentBeforeToday;
    const todayLimit = remainingAtStart > 0 ? Math.round(remainingAtStart / cycle.daysRemaining) : 0;
    const todayRemaining = todayLimit - spentToday;
    const remainingCycle = b.monthlyLimit - totalSpent;
    const daysAfterToday = Math.max(1, cycle.daysRemaining - 1);
    const nextDayDaily = remainingCycle > 0 ? Math.round(remainingCycle / daysAfterToday) : 0;

    let statusEmoji = '🟢';
    let statusText = 'Masih dalam batas aman';
    if (todayRemaining < 0) {
      statusEmoji = '🚨';
      statusText = `Over ${formatRupiah(Math.abs(todayRemaining))} hari ini!`;
    } else if (todayRemaining === 0 && todayLimit > 0) {
      statusEmoji = '⚠️';
      statusText = 'Jatah hari ini pas habis';
    }

    return (
      `🎯 *STATUS JATAH HARI INI: ${b.category.toUpperCase()}*\n` +
      `🗓️ *Hari Ini:* ${d.format('dddd, DD MMMM YYYY')}\n` +
      `⏳ *Sisa Siklus:* ${cycle.daysRemaining} hari menuju gajian (${cycle.label})\n\n` +
      `🎯 *Batas Hari Ini:* ${formatRupiah(todayLimit)}\n` +
      `💸 *Terpakai Hari Ini:* ${formatRupiah(spentToday)}\n` +
      `${statusEmoji} *Sisa Hari Ini:* ${todayRemaining >= 0 ? formatRupiah(todayRemaining) : '-' + formatRupiah(Math.abs(todayRemaining)) + ' (Over)'}\n` +
      `📌 *Status:* ${statusText}\n\n` +
      `═══════════════════════\n` +
      `📊 *Sisa Kuota Siklus:* ${formatRupiah(remainingCycle)} dari ${formatRupiah(b.monthlyLimit)}\n` +
      `💡 *Jatah Harian Besok:* ${formatRupiah(nextDayDaily)}/hari\n\n` +
      `_Tips: Setiap belanja baru otomatis memotong sisa hari ini._`
    );
  }

  const dailyCategories = [
    'Makanan & Minuman',
    'Rokok & Vape',
    'Bensin & Transportasi',
    'Nongkrong & Hiburan',
    'Belanja Bulanan',
  ];

  const todayOtherCats = transactions
    .filter((t) => t.createdAt >= startOfDay && t.createdAt <= endOfDay && !dailyCategories.includes(t.category))
    .map((t) => t.category);
  const targetCategoryList = [...new Set([...dailyCategories, ...todayOtherCats])];

  let totalTodayLimit = 0;
  let totalTodaySpent = 0;
  let itemsReport = [];

  for (const catName of targetCategoryList) {
    const b = budgets.find((item) => item.category === catName);
    if (!b) continue;

    const catTxs = transactions.filter((t) => t.category === catName);
    const totalSpent = catTxs.reduce((acc, t) => acc + t.amount, 0);
    const spentToday = catTxs
      .filter((t) => t.createdAt >= startOfDay && t.createdAt <= endOfDay)
      .reduce((acc, t) => acc + t.amount, 0);
    const spentBeforeToday = catTxs
      .filter((t) => t.createdAt < startOfDay)
      .reduce((acc, t) => acc + t.amount, 0);

    const remainingAtStart = b.monthlyLimit - spentBeforeToday;
    const todayLimit = remainingAtStart > 0 ? Math.round(remainingAtStart / cycle.daysRemaining) : 0;
    const todayRemaining = todayLimit - spentToday;
    const remainingCycle = b.monthlyLimit - totalSpent;

    totalTodayLimit += todayLimit;
    totalTodaySpent += spentToday;

    let emoji = '🟢';
    if (todayRemaining < 0) emoji = '🚨';
    else if (todayRemaining === 0 && todayLimit > 0) emoji = '⚠️';
    else if (spentToday === 0) emoji = '⚪';

    const sisaText = todayRemaining >= 0 ? formatRupiah(todayRemaining) : '-' + formatRupiah(Math.abs(todayRemaining)) + ' (Over)';

    itemsReport.push(
      `${emoji} *${catName}*\n` +
      `   Jatah: ${formatRupiah(todayLimit)} | Keluar: ${formatRupiah(spentToday)}\n` +
      `   └ 💰 *Sisa Hari Ini: ${sisaText}* _(Siklus: ${formatRupiah(remainingCycle)})_`
    );
  }

  const totalTodayRemaining = totalTodayLimit - totalTodaySpent;
  let totalEmoji = '🟢';
  if (totalTodayRemaining < 0) totalEmoji = '🚨';
  else if (totalTodayRemaining === 0) totalEmoji = '⚠️';

  return (
    `🎯 *STATUS JATAH BUDGET HARI INI*\n` +
    `🗓️ *Hari Ini:* ${d.format('dddd, DD MMMM YYYY')}\n` +
    `⏳ *Sisa Siklus:* ${cycle.daysRemaining} hari menuju gajian (${cycle.label})\n\n` +
    itemsReport.join('\n\n') +
    `\n\n═══════════════════════\n` +
    `📊 *TOTAL HARIAN (KATEGORI RUTIN):*\n` +
    `🎯 *Batas Hari Ini:* ${formatRupiah(totalTodayLimit)}\n` +
    `💸 *Total Belanja Hari Ini:* ${formatRupiah(totalTodaySpent)}\n` +
    `${totalEmoji} *Sisa Jatah Hari Ini:* ${totalTodayRemaining >= 0 ? formatRupiah(totalTodayRemaining) : '-' + formatRupiah(Math.abs(totalTodayRemaining)) + ' (Over)'}\n\n` +
    `_Tips: Belanja baru otomatis mengurangi jatah hari ini. Ketik \`budget\` untuk rekap bulanan atau \`jatah makan hari ini\` untuk kategori tertentu._`
  );
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

function matchCategory(input) {
  if (!input) return null;
  const clean = input
    .toLowerCase()
    .replace(/^(?:tolong\s+|ke\s+|dari\s+|dompet\s+|kantong\s+|jatah\s+|uang\s+|pos\s+|dana\s+)+/i, '')
    .trim();

  const aliases = {
    'makan': 'Makanan & Minuman',
    'makanan': 'Makanan & Minuman',
    'minum': 'Makanan & Minuman',
    'makanan & minuman': 'Makanan & Minuman',
    'makanan dan minuman': 'Makanan & Minuman',
    'makan & minum': 'Makanan & Minuman',
    'makan dan minum': 'Makanan & Minuman',
    'uang makan': 'Makanan & Minuman',
    'dompet makanan': 'Makanan & Minuman',
    'kantong makanan': 'Makanan & Minuman',

    'rokok': 'Rokok & Vape',
    'vape': 'Rokok & Vape',
    'rokok & vape': 'Rokok & Vape',
    'rokok dan vape': 'Rokok & Vape',

    'bensin': 'Bensin & Transportasi',
    'transport': 'Bensin & Transportasi',
    'transportasi': 'Bensin & Transportasi',
    'bensin & transportasi': 'Bensin & Transportasi',
    'bensin dan transportasi': 'Bensin & Transportasi',

    'kuota': 'Kuota & Internet',
    'internet': 'Kuota & Internet',
    'pulsa': 'Kuota & Internet',
    'kuota & internet': 'Kuota & Internet',
    'kuota dan internet': 'Kuota & Internet',

    'listrik': 'Listrik, Air & Wifi',
    'air': 'Listrik, Air & Wifi',
    'wifi': 'Listrik, Air & Wifi',
    'tagihan': 'Listrik, Air & Wifi',
    'pln': 'Listrik, Air & Wifi',
    'pdam': 'Listrik, Air & Wifi',
    'listrik, air & wifi': 'Listrik, Air & Wifi',
    'listrik air wifi': 'Listrik, Air & Wifi',
    'listrik dan air': 'Listrik, Air & Wifi',
    'listrik air dan wifi': 'Listrik, Air & Wifi',

    'bulanan': 'Belanja Bulanan',
    'belanja': 'Belanja Bulanan',
    'uang bulanan': 'Belanja Bulanan',
    'belanja bulanan': 'Belanja Bulanan',
    'sembako': 'Belanja Bulanan',
    'dompet bulanan': 'Belanja Bulanan',
    'kantong bulanan': 'Belanja Bulanan',

    'darurat': 'Dana Darurat',
    'dana darurat': 'Dana Darurat',

    'tabungan': 'Tabungan',
    'nabung': 'Tabungan',
    'investasi': 'Tabungan',
    'tabungan & investasi': 'Tabungan',
    'tabungan dan investasi': 'Tabungan',

    'nongkrong': 'Nongkrong & Hiburan',
    'hiburan': 'Nongkrong & Hiburan',
    'ngopi': 'Nongkrong & Hiburan',
    'cafe': 'Nongkrong & Hiburan',
    'nongkrong & hiburan': 'Nongkrong & Hiburan',
    'nongkrong dan hiburan': 'Nongkrong & Hiburan',

    'keluarga': 'Kirim Keluarga',
    'ortu': 'Kirim Keluarga',
    'orang tua': 'Kirim Keluarga',
    'mama': 'Kirim Keluarga',
    'ibu': 'Kirim Keluarga',
    'kirim keluarga': 'Kirim Keluarga',
  };

  const rawLower = input.toLowerCase().trim();
  if (aliases[clean]) return aliases[clean];
  if (aliases[rawLower]) return aliases[rawLower];

  const normalizedDan = clean.replace(/\bdan\b/g, '&').replace(/\s+/g, ' ').trim();
  if (aliases[normalizedDan]) return aliases[normalizedDan];

  const allCats = Object.keys(DEFAULT_BUDGETS);
  for (const cat of allCats) {
    const catLower = cat.toLowerCase();
    const catNorm = catLower.replace(/&/g, 'dan');
    if (
      catLower.includes(clean) || clean.includes(catLower) ||
      catNorm.includes(clean) || clean.includes(catNorm) ||
      catLower.includes(normalizedDan) || normalizedDan.includes(catLower)
    ) {
      return cat;
    }
  }

  return null;
}

async function transferPocketBudget(userNumber, fromCategoryInput, toCategoryInput, amount) {
  await ensureDefaultBudgets(userNumber);

  const fromCat = matchCategory(fromCategoryInput);
  const toCat = matchCategory(toCategoryInput);

  if (!fromCat) {
    return { success: false, error: `Kantong asal '${fromCategoryInput}' tidak dikenali.` };
  }
  if (!toCat) {
    return { success: false, error: `Kantong tujuan '${toCategoryInput}' tidak dikenali.` };
  }
  if (fromCat === toCat) {
    return { success: false, error: 'Kantong asal dan kantong tujuan tidak boleh sama.' };
  }
  if (!amount || amount <= 0) {
    return { success: false, error: 'Nominal yang dipindahkan harus lebih dari Rp 0.' };
  }

  const fromBudget = await prisma.budget.findUnique({
    where: { userNumber_category: { userNumber, category: fromCat } },
  });
  const toBudget = await prisma.budget.findUnique({
    where: { userNumber_category: { userNumber, category: toCat } },
  });

  const currentFromLimit = fromBudget ? fromBudget.monthlyLimit : DEFAULT_BUDGETS[fromCat] || 0;
  const currentToLimit = toBudget ? toBudget.monthlyLimit : DEFAULT_BUDGETS[toCat] || 0;

  if (currentFromLimit < amount) {
    return {
      success: false,
      error: `Limit kantong '${fromCat}' (${formatRupiah(currentFromLimit)}) lebih kecil dari nominal yang ingin dipindahkan (${formatRupiah(amount)}).`,
    };
  }

  const newFromLimit = currentFromLimit - amount;
  const newToLimit = currentToLimit + amount;

  await prisma.budget.upsert({
    where: { userNumber_category: { userNumber, category: fromCat } },
    update: { monthlyLimit: newFromLimit },
    create: { userNumber, category: fromCat, monthlyLimit: newFromLimit },
  });

  await prisma.budget.upsert({
    where: { userNumber_category: { userNumber, category: toCat } },
    update: { monthlyLimit: newToLimit },
    create: { userNumber, category: toCat, monthlyLimit: newToLimit },
  });

  const cycle = getPayCycleRange();
  const fromStatus = await checkBudgetStatus(userNumber, fromCat);
  const toStatus = await checkBudgetStatus(userNumber, toCat);

  return {
    success: true,
    amount,
    fromCategory: fromCat,
    toCategory: toCat,
    oldFromLimit: currentFromLimit,
    newFromLimit,
    oldToLimit: currentToLimit,
    newToLimit,
    fromRemaining: fromStatus.remaining,
    toRemaining: toStatus.remaining,
    toDailyAllowance: toStatus.dailyAllowance,
    daysRemaining: cycle.daysRemaining,
  };
}

function getDualCycleGuide() {
  const cycle = getPayCycleRange();

  return (
    `📋 *STRATEGI & PANDUAN DUA SIKLUS GAJI*\n` +
    `🗓️ *Siklus Aktif:* ${cycle.label}\n` +
    `⏳ *Sisa Waktu:* ${cycle.daysRemaining} hari lagi menuju gajian ${cycle.nextPaydayFormatted}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 *1. TANGGAL 21 — MASUK RP 4.100.000 (DI BSI)*\n` +
    `_Pindahkan Segera (Tgl 21–22) ke 2 Bank Tujuan:_\n\n` +
    `🟠 *A. PINDAH KE SEABANK (Total Rp 800.000 — Aset Dingin):*\n` +
    `• 🔒 *Tabungan & Investasi:* Rp 300.000\n` +
    `• 🛡️ *Dana Darurat:* Rp 500.000 (Bunga harian & terkunci aman)\n\n` +
    `🟣 *B. PINDAH KE BANK JAGO (Total Rp 3.300.000 — Masuk ke Kantong):*\n` +
    `• 👨‍👩‍👧 *Kantong Kirim Ortu:* Rp 400.000 (Langsung transfer ke ortu)\n` +
    `• 💡 *Kantong Listrik, Air & Wifi:* Rp 400.000 (Bayar tagihan)\n` +
    `• 📶 *Kantong Kuota & Internet:* Rp 100.000 (Beli paket data)\n` +
    `• 🛒 *Kantong Belanja Sembako:* Rp 400.000 (Sabun & sembako)\n` +
    `• 🍚 *Kantong Uang Makan:* Rp 1.200.000 (Jatah harian ~Rp 50.000/hari)\n` +
    `• 🚬 *Kantong Rokok & Vape:* Rp 400.000 (Jatah 1 bulan penuh)\n` +
    `• ☕ *Kantong Nongkrong & Hiburan:* Rp 400.000 (Ngopi/refreshing)\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `💵 *2. TANGGAL 1 — MASUK RP 500.000 (DI BSI)*\n` +
    `_Langsung Pindah Semua ke Bank Jago:_\n` +
    `• ⛽ *Kantong Bensin & Transport:* Rp 200.000\n` +
    `• 🍚 *Tambahan Kantong Makan:* Rp 300.000 (Melengkapi total makan jadi Rp 1.500.000 / Rp 50.000 per hari)\n\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `🤖 *AUTOMATION BOT:*\n` +
    `• Setiap Tgl 21 jam 08:00 bot otomatis catat +Rp 4.100.000\n` +
    `• Setiap Tgl 22 jam 08:00 bot otomatis kirim Pengingat Alokasi Bank (SeaBank & Jago)\n` +
    `• Setiap Tgl 1 jam 08:00 bot otomatis catat +Rp 500.000\n` +
    `• Ketik \`simulasi alokasi 22\` untuk tes notifikasi alokasi sekarang\n` +
    `• Ketik \`budget\` untuk melihat sisa kuota dan jatah harian.`
  );
}

module.exports = {
  DEFAULT_BUDGETS,
  DAILY_CATEGORIES,
  ensureDefaultBudgets,
  syncDefaultBudgets,
  checkBudgetStatus,
  generateBudgetReport,
  generateTodayBudgetReport,
  updateCategoryBudget,
  matchCategory,
  transferPocketBudget,
  getPayCycleRange,
  getDualCycleGuide,
  formatRupiah,
};
