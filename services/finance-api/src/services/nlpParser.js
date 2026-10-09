// Parser Bahasa Alami untuk Format Pencatatan Keuangan via WhatsApp

const CATEGORY_KEYWORDS = {
  'Makanan & Minuman': [
    'makan', 'minum', 'sarapan', 'lunch', 'dinner', 'nasi', 'mie', 'bakso', 'sate',
    'ayam', 'snack', 'jajan', 'grabfood', 'gofood', 'shopeefood', 'es teh', 'boba',
    'warteg', 'padang', 'kantin', 'catering'
  ],
  'Rokok & Vape': [
    'rokok', 'vape', 'vapor', 'liquid', 'pod', 'coil', 'cartridge',
    'surya', 'marlboro', 'sampoerna', 'magnum', 'gudang garam', 'esse',
    'camel', 'djarum', 'juul', 'relx', 'iqos', 'kretek', 'filter', 'tembakau'
  ],
  'Nongkrong & Hiburan': [
    'nongkrong', 'ngopi', 'kopi', 'coffee', 'cafe', 'kafe', 'bioskop', 'cinema',
    'xxi', 'spotify', 'netflix', 'youtube', 'game', 'topup', 'diamond', 'steam',
    'jalan-jalan', 'liburan', 'karaoke', 'billiard'
  ],
  'Bensin & Transportasi': [
    'bensin', 'pertalite', 'pertamax', 'solar', 'parkir', 'ojol', 'gojek',
    'grab', 'goride', 'gocar', 'maxim', 'krl', 'mrt', 'lrt', 'busway',
    'angkot', 'tol', 'cuci motor', 'cuci mobil', 'tambal ban', 'servis', 'oli'
  ],
  'Kuota & Internet': [
    'kuota', 'paket data', 'paket internet', 'pulsa', 'telkomsel', 'by.u',
    'indosat', 'xl', 'tri', 'smartfren'
  ],
  'Listrik, Air & Wifi': [
    'listrik', 'token pln', 'pln', 'air', 'pdam', 'wifi', 'indihome', 'biznet',
    'firstmedia', 'myrepublic', 'iuran sampah', 'sewa kost', 'kost', 'kontrakan'
  ],
  'Belanja Bulanan': [
    'belanja bulanan', 'indomaret', 'alfamart', 'supermarket', 'pasar',
    'sabun', 'odol', 'shampoo', 'deterjen', 'beras', 'minyak', 'telur',
    'bumbu', 'pewangi', 'pasta gigi'
  ],
  'Kirim Keluarga': [
    'kirim ortu', 'kirim ibu', 'kirim bapak', 'kirim keluarga', 'transfer ortu',
    'transfer keluarga', 'uang jajan adik', 'sedekah', 'infaq', 'zakat'
  ],
  'Dana Darurat': [
    'dana darurat', 'darurat', 'biaya berobat mendadak', 'bengkel darurat'
  ],
  'Tabungan': [
    'tabungan', 'nabung', 'simpanan', 'deposito', 'reksadana', 'saham',
    'investasi', 'beli emas', 'logam mulia', 'bibit', 'bareksa'
  ],
  'Pemasukan': [
    'gaji', 'bonus', 'freelance', 'proyek', 'omset', 'arisan', 'dividen',
    'transfer masuk', 'refund', 'kembalian', 'penjualan'
  ]
};

/**
 * Mengubah string nominal seperti "50rb", "2.5jt", "25k", "15000", "15.000" menjadi angka (number)
 */
function parseNominal(str) {
  if (!str) return null;
  const clean = str.trim().toLowerCase();

  // Pola: jutaan (jt / juta / m / million)
  const jtMatch = clean.match(/^([0-9]+(?:[.,][0-9]+)?)\s*(?:jt|juta|m)$/);
  if (jtMatch) {
    const val = parseFloat(jtMatch[1].replace(',', '.'));
    return Math.round(val * 1000000);
  }

  // Pola: ribuan (rb / ribu / k)
  const rbMatch = clean.match(/^([0-9]+(?:[.,][0-9]+)?)\s*(?:rb|ribu|k)$/);
  if (rbMatch) {
    const val = parseFloat(rbMatch[1].replace(',', '.'));
    return Math.round(val * 1000);
  }

  // Pola angka langsung: "50000" atau "50.000" atau "50,000"
  const numClean = clean.replace(/\./g, '').replace(/,/g, '');
  if (/^[0-9]+$/.test(numClean)) {
    const num = parseInt(numClean, 10);
    return isNaN(num) ? null : num;
  }

  return null;
}

/**
 * Deteksi Kategori otomatis berdasarkan deskripsi teks
 */
function detectCategory(text, type = 'expense') {
  if (type === 'income') return 'Gaji & Pemasukan';
  
  const lower = text.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (category === 'Pemasukan' && type === 'expense') continue;
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        return category;
      }
    }
  }
  return 'Lain-lain';
}

/**
 * Parse pesan WhatsApp
 */
function parseMessage(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  const text = rawText.trim();
  const lower = text.toLowerCase();

  // 1. Cek Perintah Khusus (Command)
  if (lower === 'help' || lower === 'bantuan' || lower === 'menu' || lower === 'panduan') {
    return { isCommand: true, action: 'help' };
  }

  if (lower === 'budget' || lower === 'cek budget' || lower === 'anggaran') {
    return { isCommand: true, action: 'budget' };
  }

  if (
    lower === 'alokasi' ||
    lower === 'panduan gaji' ||
    lower === 'rencana belanja' ||
    lower === 'strategi gaji' ||
    lower === 'jadwal gaji' ||
    lower === 'siklus' ||
    lower === 'cek siklus'
  ) {
    return { isCommand: true, action: 'allocation_guide' };
  }

  if (
    lower === 'simulasi gaji 21' ||
    lower === 'trigger gaji 21' ||
    lower === 'catat gaji 21' ||
    lower === 'gaji 21'
  ) {
    return { isCommand: true, action: 'trigger_salary_21' };
  }

  if (
    lower === 'simulasi gaji 1' ||
    lower === 'trigger gaji 1' ||
    lower === 'catat gaji 1' ||
    lower === 'simulasi booster' ||
    lower === 'trigger booster' ||
    lower === 'gaji 1'
  ) {
    return { isCommand: true, action: 'trigger_salary_1' };
  }

  if (lower === 'reset budget' || lower === 'reset anggaran' || lower === 'default budget') {
    return { isCommand: true, action: 'reset_budget' };
  }

  // Format: set budget [kategori] [nominal]
  // Contoh: set budget bensin 250rb
  const setBudgetMatch = text.match(/^(?:set\s+budget|atur\s+budget|set\s+anggaran)\s+([A-Za-z0-9\s,&]+)\s+([0-9]+(?:[.,][0-9]+)?\s*(?:jt|juta|rb|ribu|k)?|[0-9]{1,3}(?:\.[0-9]{3})+)$/i);
  if (setBudgetMatch) {
    const targetCat = setBudgetMatch[1].trim();
    const amountVal = parseNominal(setBudgetMatch[2]);
    if (amountVal && amountVal > 0) {
      return { isCommand: true, action: 'set_budget', categoryInput: targetCat, amount: amountVal };
    }
  }

  if (lower === 'rekap' || lower.startsWith('rekap')) {
    let period = 'today';
    if (lower.includes('bulan') || lower.includes('monthly') || lower.includes('siklus')) period = 'month';
    else if (lower.includes('minggu') || lower.includes('weekly')) period = 'week';
    else if (lower.includes('kemarin')) period = 'yesterday';
    return { isCommand: true, action: 'rekap', period };
  }

  if (lower === 'batal' || lower === 'hapus' || lower === 'undo' || lower === 'delete') {
    return { isCommand: true, action: 'undo' };
  }

  if (lower.startsWith('export') || lower.startsWith('ekspor') || lower.includes('excel')) {
    let period = 'month';
    if (lower.includes('semua') || lower.includes('all')) period = 'all';
    return { isCommand: true, action: 'export', period };
  }

  // 2. Cek Transaksi Keuangan
  let isIncome = false;
  let workingText = text;

  // Cek apakah diawali tanda '+'
  if (workingText.startsWith('+')) {
    isIncome = true;
    workingText = workingText.substring(1).trim();
  }

  // Cek kata kunci pemasukan eksplisit di awal
  const incomePrefixMatch = workingText.match(/^(?:pemasukan|income|terima|dapat)\s+/i);
  if (incomePrefixMatch) {
    isIncome = true;
    workingText = workingText.substring(incomePrefixMatch[0].length).trim();
  }

  // Regex mencari token nominal di dalam string
  const nominalRegex = /(?:rp\.?\s*)?([0-9]+(?:[.,][0-9]+)?\s*(?:jt|juta|rb|ribu|k)?|[0-9]{1,3}(?:\.[0-9]{3})+)/gi;

  let match;
  let parsedAmount = null;
  let amountMatchStr = '';

  // Cari token yang valid sebagai nominal
  while ((match = nominalRegex.exec(workingText)) !== null) {
    const candidate = match[1];
    const val = parseNominal(candidate);
    if (val !== null && val > 0) {
      parsedAmount = val;
      amountMatchStr = match[0];
      break;
    }
  }

  if (!parsedAmount) {
    return { isCommand: false, isTransaction: false, rawText: text };
  }

  // Bersihkan deskripsi dengan menghapus bagian nominal yang cocok
  let description = workingText.replace(amountMatchStr, '').trim();
  description = description.replace(/^[-–—:]\s*/, '').replace(/\s*[-–—:]$/, '').trim();

  // Ekstrak Toko / Merchant jika ada kata sambung "di", "ke", "@", atau pemisah ":"
  let merchantName = null;

  // Pola 1: "... di Indomaret" atau "... @Indomaret" di bagian akhir
  const diTokoMatch = description.match(/(?:\s+(?:di|ke|@)\s+)([A-Za-z0-9\s\.\-]{2,40})$/i);
  if (diTokoMatch) {
    merchantName = diTokoMatch[1].trim();
    description = description.substring(0, diTokoMatch.index).trim();
  } else {
    // Pola 2: "di Indomaret beli sabun"
    const prefixDiMatch = description.match(/^(?:di|ke)\s+([A-Za-z0-9\s\.\-]{2,30})\s+(?:beli|ambil|bayar|pesan)?\s+/i);
    if (prefixDiMatch) {
      merchantName = prefixDiMatch[1].trim();
      description = description.substring(prefixDiMatch[0].length).trim();
    } else {
      // Pola 3: "Indomaret : sabun dan beras"
      const colonMatch = description.match(/^([A-Za-z0-9\s\.\-]{2,30})\s*[:|]\s*(.*)$/);
      if (colonMatch) {
        merchantName = colonMatch[1].trim();
        description = colonMatch[2].trim();
      }
    }
  }

  // Jika deskripsi kosong, beri deskripsi default
  if (!description) {
    description = isIncome ? 'Pemasukan' : 'Pengeluaran';
  }

  // Cek apakah deskripsi mengindikasikan gaji/pemasukan
  if (!isIncome) {
    const lowerDesc = description.toLowerCase();
    if (
      lowerDesc.includes('gaji') ||
      lowerDesc.includes('bonus') ||
      lowerDesc.includes('dividen') ||
      lowerDesc.includes('arisan')
    ) {
      isIncome = true;
    }
  }

  const type = isIncome ? 'income' : 'expense';
  const category = detectCategory(description, type);

  return {
    isCommand: false,
    isTransaction: true,
    data: {
      type,
      amount: parsedAmount,
      description,
      category,
      merchantName,
      source: 'manual',
    },
  };
}

module.exports = {
  parseMessage,
  parseNominal,
  detectCategory,
  CATEGORY_KEYWORDS,
};
