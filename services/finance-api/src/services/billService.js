'use strict';

const prisma = require('../db');
const dayjs = require('dayjs');
const { formatRupiah } = require('./budgetService');

// Jadwal tagihan rutin bawaan. Ditanam otomatis ke tabel `Bill` saat pertama kali
// pengguna memakai fitur tagihan, supaya pengingat otomatis (schedulerService)
// langsung punya data untuk dibaca.
//
// amount = 0 berarti nominalnya fleksibel: dibiarkan kosong sampai pengguna
// mengisinya lewat `tambah tagihan <nama> <nominal> tgl <tanggal>`.
const BILL_SCHEDULES = [
  {
    name: 'WiFi (Internet Rumah)',
    dueDay: 27,
    category: 'Listrik, Air & Wifi',
    icon: '⌗',
    note: 'Jatuh tempo akhir bulan agar koneksi internet tetap lancar',
    exampleCmd: 'wifi 350rb',
  },
  {
    name: 'Air & Listrik (PDAM & PLN)',
    dueDay: 2,
    category: 'Listrik, Air & Wifi',
    icon: '▸⌗',
    note: 'Jatuh tempo awal bulan untuk token/listrik & iuran air',
    exampleCmd: 'listrik 200rb, air 100rb',
  },
];

const DEFAULT_CATEGORY = 'Listrik, Air & Wifi';

function findSchedule(name) {
  const lower = String(name || '').toLowerCase();
  return (
    BILL_SCHEDULES.find((b) => b.name.toLowerCase() === lower) ||
    BILL_SCHEDULES.find((b) => lower.includes(b.name.toLowerCase().split(' ')[0])) ||
    null
  );
}

/**
 * Tanam jadwal tagihan bawaan kalau pengguna belum punya satu pun tagihan.
 * Hanya jalan saat tabel kosong, jadi tagihan yang sengaja dihapus pengguna
 * tidak akan muncul lagi sendiri.
 */
async function ensureDefaultBills(userNumber) {
  const count = await prisma.bill.count({ where: { userNumber } });
  if (count > 0) return;

  for (const schedule of BILL_SCHEDULES) {
    await prisma.bill.create({
      data: {
        userNumber,
        name: schedule.name,
        amount: 0,
        dueDay: schedule.dueDay,
        category: schedule.category,
        isActive: true,
      },
    });
  }
}

const billSelect = {
  id: true,
  name: true,
  amount: true,
  dueDay: true,
  category: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
};

/**
 * Tambah / perbarui tagihan rutin. Nama yang sudah ada diperbarui (upsert by name)
 * sehingga perintah yang sama aman diulang.
 */
async function addBill(userNumber, name, amount, dueDay) {
  const cleanName = String(name || '').trim();
  const cleanAmount = parseFloat(amount) || 0;
  const cleanDueDay = parseInt(dueDay, 10);

  if (!cleanName) {
    return { success: false, error: 'Nama tagihan wajib diisi.' };
  }
  if (!(cleanDueDay >= 1 && cleanDueDay <= 31)) {
    return { success: false, error: 'Tanggal jatuh tempo harus antara 1 sampai 31.' };
  }

  const schedule = findSchedule(cleanName);
  const category = (schedule && schedule.category) || DEFAULT_CATEGORY;

  // Cocokkan dulu nama persis, lalu nama yang terkandung di jadwal bawaan
  // (mis. "wifi" -> "WiFi (Internet Rumah)") supaya tidak muncul duplikat.
  let existing = await prisma.bill.findFirst({
    where: { userNumber, name: { equals: cleanName, mode: 'insensitive' } },
  });
  if (!existing) {
    existing = await prisma.bill.findFirst({
      where: { userNumber, name: { contains: cleanName, mode: 'insensitive' } },
      orderBy: { dueDay: 'asc' },
    });
  }

  if (existing) {
    const bill = await prisma.bill.update({
      where: { id: existing.id },
      data: {
        amount: cleanAmount,
        dueDay: cleanDueDay,
        category,
        isActive: true,
      },
      select: billSelect,
    });
    return { success: true, isNew: false, bill };
  }

  const bill = await prisma.bill.create({
    data: {
      userNumber,
      name: cleanName,
      amount: cleanAmount,
      dueDay: cleanDueDay,
      category,
      isActive: true,
    },
    select: billSelect,
  });

  return { success: true, isNew: true, bill };
}

async function listBills(userNumber, includeInactive = false) {
  await ensureDefaultBills(userNumber);
  const where = { userNumber };
  if (!includeInactive) where.isActive = true;
  return await prisma.bill.findMany({
    where,
    orderBy: [{ dueDay: 'asc' }, { name: 'asc' }],
    select: billSelect,
  });
}

/**
 * Nonaktifkan tagihan (soft delete) supaya riwayatnya tetap tersimpan.
 */
async function removeBill(userNumber, name) {
  const cleanName = String(name || '').trim();
  if (!cleanName) {
    return { success: false, error: 'Nama tagihan wajib diisi.' };
  }

  const bill = await prisma.bill.findFirst({
    where: {
      userNumber,
      isActive: true,
      name: { contains: cleanName, mode: 'insensitive' },
    },
    // Tagihan yang nominalnya sudah diisi diprioritaskan.
    orderBy: [{ amount: 'desc' }, { dueDay: 'asc' }],
  });

  if (!bill) {
    return { success: false, error: `Tagihan rutin '${cleanName}' tidak ditemukan.` };
  }

  const updated = await prisma.bill.update({
    where: { id: bill.id },
    data: { isActive: false },
    select: billSelect,
  });

  return { success: true, bill: updated };
}

/**
 * Tandai tagihan sudah dibayar + catat otomatis ke pembukuan pengeluaran.
 */
async function payBill(userNumber, name) {
  const cleanName = String(name || '').trim();
  if (!cleanName) {
    return { success: false, error: 'Nama tagihan wajib diisi.' };
  }

  await ensureDefaultBills(userNumber);

  const bill = await prisma.bill.findFirst({
    where: {
      userNumber,
      isActive: true,
      name: { contains: cleanName, mode: 'insensitive' },
    },
    // Tagihan yang nominalnya sudah diisi diprioritaskan.
    orderBy: [{ amount: 'desc' }, { dueDay: 'asc' }],
  });

  if (!bill) {
    return {
      success: false,
      error: `Tagihan rutin '${cleanName}' tidak ditemukan. Ketik *tagihan* untuk melihat daftarnya.`,
    };
  }

  if (!(bill.amount > 0)) {
    const shortName = String(bill.name).split(' ')[0].toLowerCase();
    return {
      success: false,
      error:
        `Nominal tagihan *${bill.name}* belum diisi. ` +
        `Set dulu dengan: \`tambah tagihan ${shortName} <nominal> tgl ${bill.dueDay}\``,
    };
  }

  const transaction = await prisma.transaction.create({
    data: {
      userNumber,
      type: 'expense',
      source: 'bill_payment',
      amount: bill.amount,
      description: `Pembayaran tagihan ${bill.name}`,
      category: bill.category,
    },
  });

  return { success: true, bill, transaction };
}

function buildDueLabel(dueDay, todayDate, daysInMonth) {
  if (dueDay === todayDate) return ' ➔ ⚠ *HARI INI JATUH TEMPO!*';
  if (todayDate < dueDay) {
    return ` _(sisa ${dueDay - todayDate} hari lagi)_`;
  }
  // Jatuh tempo bulan ini sudah lewat: hitung jarak ke tanggal yang sama bulan depan.
  return ` _(sisa ${daysInMonth - todayDate + dueDay} hari lagi)_`;
}

async function generateBillReport(userNumber) {
  const now = dayjs();
  const todayDate = now.date();
  const daysInMonth = now.daysInMonth();

  const bills = await listBills(userNumber);

  if (bills.length === 0) {
    return (
      `▤ *TAGIHAN RUTIN ANDA MASIH KOSONG*\n\n` +
      `Tambahkan misalnya:\n` +
      `• \`tambah tagihan wifi 350rb tgl 27\`\n` +
      `• \`tambah tagihan listrik 200rb tgl 2\``
    );
  }

  const lines = bills.map((bill, idx) => {
    const schedule = findSchedule(bill.name);
    const icon = (schedule && schedule.icon) || '▤';
    const statusText = buildDueLabel(bill.dueDay, todayDate, daysInMonth);
    const amountText = bill.amount > 0 ? formatRupiah(bill.amount) : '_(nominal belum diisi)_';

    return (
      `${idx + 1}. ${icon} *${bill.name}*${statusText}\n` +
      `   └ ▣ *Nominal:* ${amountText}\n` +
      `   └ ⏰ *Jatuh Tempo:* Setiap Tanggal ${bill.dueDay}\n` +
      `   └ ◆ *Kantong Anggaran:* ${bill.category}`
    );
  });

  const totalFixed = bills
    .filter((b) => b.amount > 0)
    .reduce((acc, b) => acc + b.amount, 0);

  const belumDiisi = bills.filter((b) => !(b.amount > 0));

  return (
    `▤ *DAFTAR TAGIHAN RUTIN ANDA*\n\n` +
    lines.join('\n\n') +
    `\n\n═══════════════════════\n` +
    `▣ *Total Tagihan Bernominal:* ${formatRupiah(totalFixed)}\n` +
    (belumDiisi.length > 0
      ? `✎ *Belum ada nominal:* ${belumDiisi.map((b) => b.name).join(', ')}\n`
      : '') +
    `\n⚙ *Sistem Pengingat Otomatis:*\n` +
    `• Bot otomatis mengirimkan pengingat jam 09:00 pada H-1 dan hari jatuh tempo.\n\n` +
    `▸ *Perintah Cepat:*\n` +
    `• Ubah nominal/jadwal: \`tambah tagihan wifi 350rb tgl 27\`\n` +
    `• Tandai sudah dibayar: \`bayar tagihan wifi\`\n` +
    `• Hapus dari daftar: \`hapus tagihan wifi\``
  );
}

module.exports = {
  BILL_SCHEDULES,
  DEFAULT_CATEGORY,
  ensureDefaultBills,
  addBill,
  listBills,
  removeBill,
  payBill,
  generateBillReport,
};