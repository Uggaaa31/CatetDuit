'use strict';

/**
 * Memori percakapan + state klarifikasi.
 *
 * - ChatMessage: menyimpan beberapa giliran terakhir supaya AI punya konteks
 *   ("yang tadi berapa?", "eh salah, 15rb bukan 150rb").
 * - PendingClarification: menyimpan pertanyaan bot yang belum dijawab user,
 *   sehingga balasan pendek seperti "15000" bisa melanjutkan transaksi yang
 *   tadi belum dicatat (bukan membuat transaksi baru yang salah).
 */

const prisma = require('../db');

const HISTORY_TURNS = parseInt(process.env.AI_HISTORY_TURNS || '6', 10);
const HISTORY_RETENTION_DAYS = parseInt(process.env.AI_HISTORY_DAYS || '7', 10);
const PENDING_TTL_MS = parseInt(process.env.AI_PENDING_TTL_MS || '300000', 10); // 5 menit

function trim(text, max = 2000) {
  return String(text || '').slice(0, max);
}

const pruneMarks = new Map(); // userNumber -> timestamp pemangkasan terakhir

async function saveMessage(userNumber, role, content) {
  const clean = trim(content);
  if (!userNumber || !clean) return null;

  // Pangkas riwayat lama maksimal sekali sehari per pengguna (bukan tiap pesan).
  const lastPrune = pruneMarks.get(userNumber) || 0;
  if (Date.now() - lastPrune > 24 * 60 * 60 * 1000) {
    pruneMarks.set(userNumber, Date.now());
    pruneHistory(userNumber).catch(() => {});
  }

  try {
    return await prisma.chatMessage.create({
      data: { userNumber, role: role === 'assistant' ? 'assistant' : 'user', content: clean },
    });
  } catch (err) {
    console.warn('[chatMemory] Gagal menyimpan pesan:', err.message);
    return null;
  }
}

/**
 * Ambil beberapa giliran terakhir (tanpa pesan user yang baru saja disimpan).
 * Bentuknya siap dikirim ke service AI: [{ role: 'user'|'assistant', content }]
 */
async function getRecentHistory(userNumber) {
  if (!userNumber) return [];
  try {
    const rows = await prisma.chatMessage.findMany({
      where: { userNumber },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_TURNS + 1,
    });
    let list = rows.slice().reverse();
    // Buang pesan user terakhir (pesan yang sedang diproses) supaya tidak dobel.
    if (list.length > 0 && list[list.length - 1].role === 'user') {
      list = list.slice(0, -1);
    }
    return list.slice(-HISTORY_TURNS).map((row) => ({
      role: row.role === 'assistant' ? 'assistant' : 'user',
      content: trim(row.content, 600),
    }));
  } catch (err) {
    console.warn('[chatMemory] Gagal membaca riwayat:', err.message);
    return [];
  }
}

async function pruneHistory(userNumber) {
  if (!userNumber) return 0;
  try {
    const cutoff = new Date(Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const res = await prisma.chatMessage.deleteMany({
      where: { userNumber, createdAt: { lt: cutoff } },
    });
    return res.count || 0;
  } catch (err) {
    console.warn('[chatMemory] Gagal memangkas riwayat:', err.message);
    return 0;
  }
}

async function setPending(userNumber, question, context) {
  if (!userNumber || !question) return null;
  const payload = {
    question: trim(question, 500),
    contextJson: JSON.stringify(context || {}).slice(0, 2000),
  };
  try {
    return await prisma.pendingClarification.upsert({
      where: { userNumber },
      update: payload,
      create: { userNumber, ...payload },
    });
  } catch (err) {
    console.warn('[chatMemory] Gagal menyimpan klarifikasi tertunda:', err.message);
    return null;
  }
}

/** true kalau ada pertanyaan bot yang belum dijawab dan belum kedaluwarsa. */
async function hasPendingClarification(userNumber) {
  if (!userNumber) return false;
  try {
    const row = await prisma.pendingClarification.findUnique({ where: { userNumber } });
    if (!row) return false;
    const age = Date.now() - new Date(row.createdAt).getTime();
    if (age > PENDING_TTL_MS) {
      await clearPending(userNumber);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[chatMemory] Gagal cek klarifikasi tertunda:', err.message);
    return false;
  }
}

/** Ambil sekaligus hapus (supaya tidak dipakai dua kali). */
async function takePending(userNumber) {
  if (!userNumber) return null;
  try {
    const row = await prisma.pendingClarification.findUnique({ where: { userNumber } });
    if (!row) return null;
    await prisma.pendingClarification.deleteMany({ where: { userNumber } });

    const age = Date.now() - new Date(row.createdAt).getTime();
    if (age > PENDING_TTL_MS) return null;

    let context = {};
    try {
      context = JSON.parse(row.contextJson || '{}');
    } catch (err) {
      context = {};
    }
    return { question: row.question, context };
  } catch (err) {
    console.warn('[chatMemory] Gagal mengambil klarifikasi tertunda:', err.message);
    return null;
  }
}

async function clearPending(userNumber) {
  if (!userNumber) return 0;
  try {
    const res = await prisma.pendingClarification.deleteMany({ where: { userNumber } });
    return res.count || 0;
  } catch (err) {
    return 0;
  }
}

module.exports = {
  HISTORY_TURNS,
  PENDING_TTL_MS,
  saveMessage,
  getRecentHistory,
  pruneHistory,
  setPending,
  hasPendingClarification,
  takePending,
  clearPending,
};