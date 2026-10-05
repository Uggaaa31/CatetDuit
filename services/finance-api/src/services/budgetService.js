const prisma = require('../db');
const dayjs = require('dayjs');

const DEFAULT_BUDGETS = {
  'Makanan & Minuman': 1400000,
  'Bensin & Transportasi': 200000,
  'Kuota & Internet': 100000,
  'Listrik, Air & Wifi': 400000,
  'Belanja Bulanan': 400000,
  'Dana Darurat': 500000,
  'Tabungan': 300000,
  'Nongkrong & Hiburan': 400000,
  'Kirim Keluarga': 400000,
  'Rokok & Vape': 500000,
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

  const startOfMonth = dayjs().startOf('month').toDate();

  const transactions = await prisma.transaction.findMany({
    where: {
      userNumber,
      category,
      type: 'expense',
      createdAt: { gte: startOfMonth },
    },
  });

  const totalSpent = transactions.reduce((acc, t) => acc + t.amount, 0);
  const percentage = Math.round((totalSpent / budget.monthlyLimit) * 100);
  const remaining = budget.monthlyLimit - totalSpent;

  return {
    hasBudget: true,
    category,
    monthlyLimit: budget.monthlyLimit,
    totalSpent,
    remaining,
    percentage,
    isWarning: percentage >= 80 && percentage < 100,
    isOverbudget: percentage >= 100,
  };
}

async function generateBudgetReport(userNumber) {
  await ensureDefaultBudgets(userNumber);

  const budgets = await prisma.budget.findMany({
    where: { userNumber },
    orderBy: { monthlyLimit: 'desc' },
  });

  const startOfMonth = dayjs().startOf('month').toDate();
  const transactions = await prisma.transaction.findMany({
    where: {
      userNumber,
      type: 'expense',
      createdAt: { gte: startOfMonth },
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

    reportItems.push(
      `${statusEmoji} *${b.category}*\n` +
      `[${bar}] ${pct}%\n` +
      `Terpakai: ${formatRupiah(spent)} / ${formatRupiah(b.monthlyLimit)}\n` +
      `Sisa: ${sisa >= 0 ? formatRupiah(sisa) : `-${formatRupiah(Math.abs(sisa))} (Over)`}`
    );
  });

  const overallPct = totalLimit > 0 ? Math.round((totalSpent / totalLimit) * 100) : 0;
  const overallBar = renderProgressBar(overallPct, 12);
  const monthName = dayjs().format('MMMM YYYY');

  const message =
    `🎯 *STATUS ANGGARAN & BUDGET BULAN INI*\n` +
    `🗓️ *Periode:* ${monthName}\n\n` +
    reportItems.join('\n\n') +
    `\n\n═══════════════════════\n` +
    `📊 *TOTAL KESELURUHAN:*\n` +
    `[${overallBar}] ${overallPct}%\n` +
    `💸 *Terpakai:* ${formatRupiah(totalSpent)}\n` +
    `🎯 *Batas Anggaran:* ${formatRupiah(totalLimit)}\n` +
    `💰 *Sisa Alokasi:* ${formatRupiah(totalLimit - totalSpent)}\n\n` +
    `_Tips: Ketik \`set budget [kategori] [nominal]\` untuk mengubah limit (contoh: \`set budget bensin 250rb\`)._`;

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

module.exports = {
  DEFAULT_BUDGETS,
  ensureDefaultBudgets,
  checkBudgetStatus,
  generateBudgetReport,
  updateCategoryBudget,
  formatRupiah,
};
