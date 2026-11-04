'use strict';

/**
 * Ringkasan angka keuangan untuk dikirim ke AI sebagai "fakta".
 *
 * Tujuannya: saat user bertanya "bulan ini aku paling boros apa?", AI tidak
 * menghitung sendiri (rawan salah) melainkan hanya merangkai kalimat dari angka
 * yang sudah pasti dari database.
 */

const prisma = require('../db');
const dayjs = require('dayjs');
const { getPayCycleRange, DEFAULT_BUDGETS } = require('./budgetService');

const MAX_CATEGORIES = 6;

function rupiahRound(value) {
  return Math.round(Number(value) || 0);
}

async function buildFacts(userNumber) {
  const cycle = getPayCycleRange();
  const startToday = dayjs().startOf('day').toDate();
  const endToday = dayjs().endOf('day').toDate();

  const [cycleTxs, budgets, todayTxs] = await Promise.all([
    prisma.transaction.findMany({
      where: { userNumber, createdAt: { gte: cycle.start, lte: cycle.end } },
    }),
    prisma.budget.findMany({ where: { userNumber } }),
    prisma.transaction.findMany({
      where: { userNumber, createdAt: { gte: startToday, lte: endToday } },
    }),
  ]);

  let totalIncome = 0;
  let totalExpense = 0;
  const spentMap = {};

  for (const tx of cycleTxs) {
    if (tx.type === 'income') {
      totalIncome += tx.amount;
    } else {
      totalExpense += tx.amount;
      spentMap[tx.category] = (spentMap[tx.category] || 0) + tx.amount;
    }
  }

  const limitMap = {};
  for (const budget of budgets) {
    limitMap[budget.category] = budget.monthlyLimit;
  }

  const allCategories = new Set([
    ...Object.keys(DEFAULT_BUDGETS),
    ...Object.keys(limitMap),
    ...Object.keys(spentMap),
  ]);

  const perCategory = Array.from(allCategories)
    .map((category) => {
      const limit = limitMap[category] != null ? limitMap[category] : DEFAULT_BUDGETS[category] || 0;
      const spent = spentMap[category] || 0;
      return {
        kategori: category,
        limit: rupiahRound(limit),
        terpakai: rupiahRound(spent),
        sisa: rupiahRound(limit - spent),
      };
    })
    .sort((a, b) => b.terpakai - a.terpakai)
    .slice(0, MAX_CATEGORIES);

  const totalToday = todayTxs.reduce((acc, tx) => acc + (tx.type === 'income' ? 0 : tx.amount), 0);
  const top = perCategory[0] && perCategory[0].terpakai > 0 ? perCategory[0] : null;

  // Jatah harian dihitung di sini (bukan oleh AI) supaya AI cukup mengutip angkanya.
  const foodRow = perCategory.find((row) => row.kategori === 'Makanan & Minuman');
  const jatahHarianMakanan =
    foodRow && foodRow.sisa > 0 ? Math.round(foodRow.sisa / Math.max(1, cycle.daysRemaining)) : 0;

  return {
    periode_siklus: cycle.label,
    sisa_hari_ke_gajian: cycle.daysRemaining,
    total_hari_siklus: cycle.totalDays,
    total_pemasukan_siklus: rupiahRound(totalIncome),
    total_pengeluaran_siklus: rupiahRound(totalExpense),
    saldo_siklus: rupiahRound(totalIncome - totalExpense),
    jumlah_transaksi_siklus: cycleTxs.length,
    pengeluaran_hari_ini: rupiahRound(totalToday),
    jumlah_transaksi_hari_ini: todayTxs.length,
    kategori_terboros: top ? { kategori: top.kategori, nominal: top.terpakai } : null,
    jatah_harian_makanan: jatahHarianMakanan,
    rincian_kategori: perCategory,
    catatan: 'Semua angka dalam rupiah dan sudah final dari database. Jangan menghitung ulang.',
  };
}

module.exports = { buildFacts };