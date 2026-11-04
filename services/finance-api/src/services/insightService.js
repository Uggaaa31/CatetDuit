'use strict';

/**
 * Insight proaktif: rekap malam & insight mingguan yang dikarang AI dari data
 * agregat (bukan template kaku), plus deteksi anomali kategori.
 *
 * Kalau AI tidak tersedia, semua fungsi mengembalikan null dan pemanggil
 * (schedulerService) memakai template lama sebagai cadangan.
 */

const prisma = require('../db');
const dayjs = require('dayjs');
const { getPayCycleRange } = require('./budgetService');
const { buildFacts } = require('./financeFacts');
const { generateInsight } = require('./ocrClient');

const ANOMALY_RATIO = parseFloat(process.env.INSIGHT_ANOMALY_RATIO || '1.3');
const ANOMALY_MIN_AMOUNT = parseInt(process.env.INSIGHT_ANOMALY_MIN || '50000', 10);

/**
 * Kumpulkan bahan insight: fakta siklus ini, pembanding siklus lalu, anomali,
 * dan pengeluaran terbesar hari ini.
 */
async function collectInsightData(userNumber) {
  const facts = await buildFacts(userNumber);
  const cycle = getPayCycleRange();

  // Siklus sebelumnya: sehari sebelum siklus ini dimulai.
  const prevCycle = getPayCycleRange(dayjs(cycle.start).subtract(1, 'day'));
  const prevTxs = await prisma.transaction.findMany({
    where: {
      userNumber,
      type: 'expense',
      createdAt: { gte: prevCycle.start, lte: prevCycle.end },
    },
  });

  const prevMap = {};
  let prevTotal = 0;
  for (const tx of prevTxs) {
    prevMap[tx.category] = (prevMap[tx.category] || 0) + tx.amount;
    prevTotal += tx.amount;
  }

  // Bandingkan LAJU harian (bukan total mentah) karena siklus ini belum selesai.
  const daysPassed = Math.max(1, cycle.daysPassed);
  const prevDays = Math.max(1, prevCycle.totalDays);
  const anomalies = [];

  for (const row of facts.rincian_kategori) {
    const prevAmount = prevMap[row.kategori] || 0;
    if (prevAmount <= 0) continue;
    if (row.terpakai < ANOMALY_MIN_AMOUNT) continue;

    const rateNow = row.terpakai / daysPassed;
    const ratePrev = prevAmount / prevDays;
    if (ratePrev <= 0) continue;

    const ratio = rateNow / ratePrev;
    if (ratio >= ANOMALY_RATIO) {
      anomalies.push({
        kategori: row.kategori,
        per_hari_sekarang: Math.round(rateNow),
        per_hari_siklus_lalu: Math.round(ratePrev),
        kenaikan_persen: Math.round((ratio - 1) * 100),
      });
    }
  }

  const startToday = dayjs().startOf('day').toDate();
  const endToday = dayjs().endOf('day').toDate();
  const todayTop = await prisma.transaction.findMany({
    where: { userNumber, type: 'expense', createdAt: { gte: startToday, lte: endToday } },
    orderBy: { amount: 'desc' },
    take: 3,
  });

  return {
    ...facts,
    perbandingan_siklus_lalu: {
      periode: prevCycle.label,
      total_pengeluaran: Math.round(prevTotal),
      selisih_total: Math.round(facts.total_pengeluaran_siklus - prevTotal),
    },
    anomali_kenaikan: anomalies,
    pengeluaran_terbesar_hari_ini: todayTop.map((tx) => ({
      keterangan: tx.description,
      kategori: tx.category,
      nominal: Math.round(tx.amount),
    })),
  };
}

async function generateNightlyInsight(userNumber, senderName = 'Bro') {
  const data = await collectInsightData(userNumber);
  const ai = await generateInsight('nightly', senderName, data);
  return ai && ai.text ? ai : null;
}

async function generateWeeklyInsight(userNumber, senderName = 'Bro') {
  const data = await collectInsightData(userNumber);
  const ai = await generateInsight('weekly', senderName, data);
  return ai && ai.text ? ai : null;
}

module.exports = {
  collectInsightData,
  generateNightlyInsight,
  generateWeeklyInsight,
};