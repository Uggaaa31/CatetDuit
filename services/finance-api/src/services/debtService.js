const prisma = require('../db');
const { formatRupiah } = require('./budgetService');
const dayjs = require('dayjs');

async function addDebt(userNumber, type, personName, amount, description = '') {
  const cleanType = type === 'loan' ? 'loan' : 'debt';
  const cleanAmount = parseFloat(amount) || 0;

  const debt = await prisma.debt.create({
    data: {
      userNumber,
      type: cleanType,
      personName: personName.trim(),
      amount: cleanAmount,
      description: description.trim() || null,
      isPaid: false,
    },
  });

  return debt;
}

async function settleDebt(userNumber, personName, type = null) {
  const where = {
    userNumber,
    personName: { contains: personName, mode: 'insensitive' },
    isPaid: false,
  };
  if (type) {
    where.type = type;
  }

  const existing = await prisma.debt.findFirst({
    where,
    orderBy: { createdAt: 'desc' },
  });

  if (!existing) {
    return { success: false, error: `Catatan hutang/piutang atas nama '${personName}' yang belum lunas tidak ditemukan.` };
  }

  const updated = await prisma.debt.update({
    where: { id: existing.id },
    data: {
      isPaid: true,
      paidAt: new Date(),
    },
  });

  return { success: true, debt: updated };
}

async function listDebts(userNumber) {
  return await prisma.debt.findMany({
    where: { userNumber, isPaid: false },
    orderBy: { createdAt: 'desc' },
  });
}

async function generateDebtReport(userNumber) {
  const debts = await listDebts(userNumber);

  const loans = debts.filter((d) => d.type === 'loan'); // Piutang (orang pinjam ke kita)
  const myDebts = debts.filter((d) => d.type === 'debt'); // Hutang (kita pinjam ke orang)

  let totalLoans = 0;
  let totalDebts = 0;

  let loanLines = '';
  if (loans.length > 0) {
    loanLines = '*🟢 PIUTANG (Uang Anda di Orang Lain):*\n';
    loans.forEach((l, idx) => {
      totalLoans += l.amount;
      const desc = l.description ? ` (${l.description})` : '';
      const date = dayjs(l.createdAt).format('DD/MM/YY');
      loanLines += `${idx + 1}. *${l.personName}*: ${formatRupiah(l.amount)}${desc} _[${date}]_\n`;
    });
  } else {
    loanLines = '*🟢 PIUTANG:* Tidak ada orang yang berhutang ke Anda.\n';
  }

  let debtLines = '';
  if (myDebts.length > 0) {
    debtLines = '\n*🔴 HUTANG (Kewajiban Harus Anda Bayar):*\n';
    myDebts.forEach((d, idx) => {
      totalDebts += d.amount;
      const desc = d.description ? ` (${d.description})` : '';
      const date = dayjs(d.createdAt).format('DD/MM/YY');
      debtLines += `${idx + 1}. *${d.personName}*: ${formatRupiah(d.amount)}${desc} _[${date}]_\n`;
    });
  } else {
    debtLines = '\n*🔴 HUTANG:* Anda tidak memiliki tanggungan hutang. Bersih! 👍\n';
  }

  return (
    `📒 *BUKU CATATAN HUTANG & PIUTANG*\n\n` +
    loanLines +
    debtLines +
    `\n═══════════════════════\n` +
    `💰 *Total Piutang (Harus Ditagih):* ${formatRupiah(totalLoans)}\n` +
    `💸 *Total Hutang (Harus Dibayar):* ${formatRupiah(totalDebts)}\n\n` +
    `💡 *Perintah Cepat:*\n` +
    `• Catat Piutang: \`pinjamkan Budi 100rb\` atau \`piutang Budi 100rb\`\n` +
    `• Catat Hutang: \`hutang ke Andi 50rb\` atau \`pinjam Andi 50rb\`\n` +
    `• Pelunasan: \`lunas piutang Budi\` atau \`lunas hutang Andi\``
  );
}

module.exports = {
  addDebt,
  settleDebt,
  listDebts,
  generateDebtReport,
};
