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
 * Ekstrak item-item transaksi dari string teks
 * Mendukung single item maupun multi-item (dipisahkan baris baru, koma, atau kata hubung)
 */
function extractTransactionItems(text) {
  let workingText = text.trim();
  let globalMerchant = null;

  // Cek prefix merchant: 'di indomaret: sabun 20rb, odol 15rb'
  const prefixMerchantMatch = workingText.match(/^(?:di|ke)\s+([A-Za-z0-9\s.\-]{2,30})\s*[:|-]\s*(.+)$/i);
  if (prefixMerchantMatch) {
    globalMerchant = prefixMerchantMatch[1].trim();
    workingText = prefixMerchantMatch[2].trim();
  }

  // Cek suffix merchant: 'sabun 20rb, odol 15rb di indomaret'
  const suffixMerchantMatch = workingText.match(/(.+?)\s+(?:di|ke)\s+([A-Za-z0-9\s.\-]{2,30})$/i);
  if (suffixMerchantMatch) {
    const candidateSuffix = suffixMerchantMatch[2].trim();
    if (!parseNominal(candidateSuffix)) {
      globalMerchant = candidateSuffix;
      workingText = suffixMerchantMatch[1].trim();
    }
  }

  const nominalRegex = /(?:rp\.?\s*)?([0-9]+(?:[.,][0-9]+)?\s*(?:jt|juta|rb|ribu|k)?|[0-9]{1,3}(?:\.[0-9]{3})+)/gi;
  const allNominalMatches = workingText.match(nominalRegex) || [];

  if (allNominalMatches.length === 0) {
    return [];
  }

  let candidateChunks = [workingText];

  // Jika ada lebih dari 1 nominal, lakukan pembagian berdasarkan delimiter
  if (allNominalMatches.length > 1) {
    if (workingText.includes('\n')) {
      candidateChunks = workingText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    } else if (workingText.includes(',') || workingText.includes(';')) {
      candidateChunks = workingText.split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
    } else {
      candidateChunks = workingText.split(/\s+(?:dan|sama|plus|\+)\s+/i).map((s) => s.trim()).filter(Boolean);
    }

    // Perhalus jika chunk masih berisi lebih dari 1 nominal
    let refinedChunks = [];
    for (const chunk of candidateChunks) {
      const chunkNoms = chunk.match(nominalRegex) || [];
      if (chunkNoms.length > 1) {
        const subChunks = chunk.split(/\s+(?:dan|sama|plus|\+)\s+/i).map((s) => s.trim()).filter(Boolean);
        refinedChunks.push(...subChunks);
      } else {
        refinedChunks.push(chunk);
      }
    }
    candidateChunks = refinedChunks;
  }

  const items = [];
  for (const chunk of candidateChunks) {
    let itemText = chunk.replace(/^[-•*0-9.]+\s*/, '').trim();
    let isIncome = false;

    if (itemText.startsWith('+')) {
      isIncome = true;
      itemText = itemText.substring(1).trim();
    }

    const incomePrefixMatch = itemText.match(/^(?:pemasukan|income|terima|dapat)\s+/i);
    if (incomePrefixMatch) {
      isIncome = true;
      itemText = itemText.substring(incomePrefixMatch[0].length).trim();
    }

    nominalRegex.lastIndex = 0;
    const match = nominalRegex.exec(itemText);
    if (!match) continue;

    const parsedAmount = parseNominal(match[1]);
    if (!parsedAmount || parsedAmount <= 0) continue;

    let description = itemText.replace(match[0], '').trim();
    description = description.replace(/^[-–—:]\s*/, '').replace(/\s*[-–—:]$/, '').trim();

    let merchantName = globalMerchant;
    const diTokoMatch = description.match(/(?:\s+(?:di|ke|@)\s+)([A-Za-z0-9\s.\-]{2,40})$/i);
    if (diTokoMatch) {
      merchantName = diTokoMatch[1].trim();
      description = description.substring(0, diTokoMatch.index).trim();
    }

    if (!description) {
      description = isIncome ? 'Pemasukan' : 'Pengeluaran';
    }

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

    items.push({
      type,
      amount: parsedAmount,
      description,
      category,
      merchantName: merchantName || null,
      source: 'manual',
    });
  }

  return items;
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

  if (
    lower === 'simulasi pengingat malam' ||
    lower === 'trigger pengingat malam' ||
    lower === 'tes pengingat malam' ||
    lower === 'pengingat malam' ||
    lower === 'reminder malam'
  ) {
    return { isCommand: true, action: 'trigger_nightly_reminder' };
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

  // 2. Cek Transaksi Keuangan (Single Item atau Multi-Item)
  const items = extractTransactionItems(text);
  if (items.length > 0) {
    return {
      isCommand: false,
      isTransaction: true,
      isMulti: items.length > 1,
      items,
      data: items[0], // Backwards compatibility untuk handler single-item
    };
  }

  return { isCommand: false, isTransaction: false, rawText: text };
}

module.exports = {
  parseMessage,
  parseNominal,
  detectCategory,
  extractTransactionItems,
  CATEGORY_KEYWORDS,
};
