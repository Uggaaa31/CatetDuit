const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const dayjs = require('dayjs');

const MEDIA_DIR = process.env.MEDIA_DIR || path.join(__dirname, '../../media');
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

async function generateFinancialExcel(transactions, title = 'Laporan Keuangan') {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Catat Duit WhatsApp';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Laporan Transaksi', {
    views: [{ showGridLines: true }],
  });

  // Title Row
  worksheet.mergeCells('A1:G1');
  const titleCell = worksheet.getCell('A1');
  titleCell.value = `📊 ${title.toUpperCase()}`;
  titleCell.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E293B' },
  };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getRow(1).height = 35;

  // Subtitle / Date
  worksheet.mergeCells('A2:G2');
  const subCell = worksheet.getCell('A2');
  subCell.value = `Diekspor pada: ${dayjs().format('DD MMMM YYYY, HH:mm:ss')}`;
  subCell.font = { italic: true, size: 10, color: { argb: 'FF64748B' } };
  subCell.alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getRow(2).height = 20;

  // Header Table
  const headers = [
    { header: 'No', key: 'no', width: 6 },
    { header: 'Tanggal & Jam', key: 'date', width: 22 },
    { header: 'Tipe', key: 'type', width: 14 },
    { header: 'Kategori', key: 'category', width: 20 },
    { header: 'Keterangan', key: 'description', width: 32 },
    { header: 'Merchant/Toko', key: 'merchant', width: 22 },
    { header: 'Nominal (Rp)', key: 'amount', width: 18 },
  ];

  const headerRow = worksheet.getRow(4);
  headerRow.values = headers.map((h) => h.header);
  headerRow.height = 25;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF334155' },
    };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  // Populate data
  let totalIncome = 0;
  let totalExpense = 0;

  transactions.forEach((tx, idx) => {
    const rowNumber = 5 + idx;
    const isIncome = tx.type === 'income';

    if (isIncome) totalIncome += tx.amount;
    else totalExpense += tx.amount;

    const row = worksheet.getRow(rowNumber);
    row.values = [
      idx + 1,
      dayjs(tx.createdAt).format('DD/MM/YYYY HH:mm'),
      isIncome ? 'PEMASUKAN' : 'PENGELUARAN',
      tx.category || '-',
      tx.description || '-',
      tx.merchantName || '-',
      tx.amount,
    ];

    row.height = 20;

    // Formatting cells
    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(2).alignment = { horizontal: 'center' };
    row.getCell(3).alignment = { horizontal: 'center' };
    row.getCell(3).font = {
      bold: true,
      color: { argb: isIncome ? 'FF16A34A' : 'FFDC2626' },
    };
    row.getCell(7).numFmt = '#,##0';
    row.getCell(7).alignment = { horizontal: 'right' };
  });

  // Summary at the bottom
  const lastRow = 5 + transactions.length + 1;

  worksheet.getCell(`E${lastRow}`).value = 'Total Pemasukan:';
  worksheet.getCell(`E${lastRow}`).font = { bold: true };
  worksheet.getCell(`G${lastRow}`).value = totalIncome;
  worksheet.getCell(`G${lastRow}`).numFmt = '#,##0';
  worksheet.getCell(`G${lastRow}`).font = { bold: true, color: { argb: 'FF16A34A' } };

  worksheet.getCell(`E${lastRow + 1}`).value = 'Total Pengeluaran:';
  worksheet.getCell(`E${lastRow + 1}`).font = { bold: true };
  worksheet.getCell(`G${lastRow + 1}`).value = totalExpense;
  worksheet.getCell(`G${lastRow + 1}`).numFmt = '#,##0';
  worksheet.getCell(`G${lastRow + 1}`).font = { bold: true, color: { argb: 'FFDC2626' } };

  worksheet.getCell(`E${lastRow + 2}`).value = 'Sisa Saldo:';
  worksheet.getCell(`E${lastRow + 2}`).font = { bold: true };
  worksheet.getCell(`G${lastRow + 2}`).value = totalIncome - totalExpense;
  worksheet.getCell(`G${lastRow + 2}`).numFmt = '#,##0';
  worksheet.getCell(`G${lastRow + 2}`).font = { bold: true };

  // Set column widths
  headers.forEach((h, i) => {
    worksheet.getColumn(i + 1).width = h.width;
  });

  const fileName = `Laporan_Keuangan_${dayjs().format('YYYYMMDD_HHmmss')}.xlsx`;
  const exportPath = path.join(MEDIA_DIR, fileName);

  await workbook.xlsx.writeFile(exportPath);
  return { exportPath, fileName, totalIncome, totalExpense, count: transactions.length };
}

module.exports = {
  generateFinancialExcel,
};
