// Parser Bahasa Alami untuk Format Pencatatan Keuangan via WhatsApp

const CATEGORY_KEYWORDS = {
  'Makanan & Minuman': [
    // Kata umum makan & minum
    'makan', 'minum', 'sarapan', 'lunch', 'dinner', 'jajan', 'ngemil', 'nyemil', 'order', 'pesan makan',
    'lauk', 'sayur', 'sayuran', 'bungkus', 'makanan', 'minuman', 'kuliner', 'cemilan', 'snack', 'kantin',
    'katering', 'catering', 'warteg', 'padang', 'warung makan', 'rumah makan', 'resto', 'restoran',
    'grabfood', 'gofood', 'shopeefood', 'maxim food',
    // Makanan spesifik sehari-hari
    'nasi', 'nasgor', 'nasi goreng', 'nasi uduk', 'nasi kuning', 'nasi campur', 'nasi padang', 'nasi bakar',
    'mie', 'bakmi', 'mie ayam', 'mie instan', 'indomie', 'mie goreng', 'mie kuah', 'mie rebus', 'kwetiau', 'bihun',
    'bakso', 'baso', 'sate', 'soto', 'rawon', 'pecel', 'pecel lele', 'lalapan', 'penyet', 'geprek', 'ayam geprek',
    'ayam goreng', 'ayam bakar', 'ayam', 'bebek', 'lele', 'ikan', 'ikan bakar', 'ikan goreng', 'seafood', 'cumi', 'udang',
    'tahu', 'tempe', 'telur', 'telor', 'martabak', 'terang bulan', 'seblak', 'cilok', 'cireng', 'siomay', 'batagor',
    'pempek', 'bubur', 'bubur ayam', 'lontong', 'ketoprak', 'gado-gado', 'karedok', 'burger', 'pizza', 'kebab',
    'dimsum', 'hotdog', 'sandwich', 'pasta', 'spaghetti', 'steak', 'roti', 'donat', 'kue', 'croissant',
    'mcd', 'kfc', 'hokben', 'dcost', 'solaria', 'richeese', 'aw', 'burger king', 'marugame',
    // Minuman
    'es teh', 'teh manis', 'teh botol', 'teh pucuk', 'es jeruk', 'jeruk peras', 'jus', 'juice', 'jus buah',
    'alpukat', 'mangga', 'pop ice', 'boba', 'chatime', 'haus', 'xiboba', 'teh', 'es kelapa', 'kelapa muda',
    'air mineral', 'aqua', 'le minerale', 'cleo', 'vit', 'club', 'susu', 'susu ultra', 'milo', 'yakult', 'yoghurt',
    'cappuccino', 'latte', 'chocolatos', 'cincau', 'cendol', 'dawet', 'wedang', 'ronde', 'sekoteng'
  ],
  'Rokok & Vape': [
    // Rokok konvensional & merek
    'rokok', 'sebungkus rokok', 'batangan rokok', 'tembakau', 'cerutu', 'korek', 'korek api', 'tokai', 'cricket',
    'surya', 'gudang garam', 'sampoerna', 'mild', 'marlboro', 'magnum', 'esse', 'djarum', 'djarum super',
    'djarum coklat', 'camel', 'filter', 'kretek', 'la lights', 'u mild', 'clas mild', 'pro mild', 'dunhill',
    'lucky strike', 'diplomat', 'wismilak', 'forte', 'sin', 'win', 'scorpion', 'apache',
    // Vape & pods
    'vape', 'vapor', 'liquid', 'e-liquid', 'saltnic', 'freebase', 'pod', 'coil', 'cartridge', 'mod', 'rda', 'rta',
    'relx', 'juul', 'iqos', 'heets', 'terea', 'kapas vape', 'cotton vape'
  ],
  'Nongkrong & Hiburan': [
    // Kafe & nongkrong
    'nongkrong', 'ngopi', 'kopi', 'coffee', 'cafe', 'kafe', 'coffee shop', 'kedai kopi', 'warkop',
    'janji jiwa', 'kopi kenangan', 'starbucks', 'fore', 'point coffee', 'kulo', 'tomoro', 'excelso',
    'jco', 'dunkin', 'mixue',
    // Hiburan, games, bioskop
    'bioskop', 'cinema', 'xxi', 'cgv', 'cinepolis', 'nonton', 'tiket bioskop', 'film',
    'game', 'gaming', 'topup', 'top up', 'diamond', 'mlbb', 'mobile legends', 'free fire', 'ff', 'pubg',
    'steam', 'genshin', 'roblox', 'playstation', 'ps', 'rental ps', 'warnet', 'billiard', 'biliar',
    'karaoke', 'inul vizta', 'masterpiece', 'timezone', 'funworld',
    // Langganan hiburan & rekreasi
    'spotify', 'netflix', 'youtube', 'yt premium', 'disney', 'vidio', 'canva', 'apple music',
    'liburan', 'jalan-jalan', 'staycation', 'hotel', 'villa', 'tiket wisata', 'pantai', 'gunung', 'wisata'
  ],
  'Bensin & Transportasi': [
    // BBM & SPBU
    'bensin', 'pertalite', 'pertamax', 'turbo', 'solar', 'dexlite', 'spbu', 'pom bensin', 'pertamina', 'shell', 'bp', 'vivo',
    // Ojol & Angkutan
    'ojol', 'gojek', 'goride', 'gocar', 'grab', 'grabride', 'grabcar', 'maxim', 'indrive', 'taksi', 'bluebird',
    'krl', 'commuter line', 'mrt', 'lrt', 'busway', 'transjakarta', 'angkot', 'mikrolet', 'bis', 'bus', 'travel',
    'kereta', 'tiket kereta', 'kai', 'pesawat', 'tiket pesawat', 'kapal', 'feri',
    // Parkir, Tol, Kendaraan
    'parkir', 'karcis parkir', 'tol', 'etoll', 'e-toll', 'e-money', 'flazz', 'tapcash',
    // Bengkel & Perawatan
    'servis', 'service', 'bengkel', 'oli', 'ganti oli', 'tambal ban', 'cuci motor', 'cuci mobil', 'steam motor',
    'isi angin', 'nitrogen', 'ban', 'ban motor', 'ban mobil', 'sparepart', 'aki', 'kampas rem', 'helm', 'spion'
  ],
  'Kuota & Internet': [
    'kuota', 'paket data', 'paket internet', 'internet hp', 'pulsa', 'isi pulsa', 'beli pulsa',
    'telkomsel', 'by.u', 'byu', 'indosat', 'im3', 'xl', 'axis', 'tri', '3', 'smartfren', 'liveon'
  ],
  'Listrik, Air & Wifi': [
    // Listrik & Air
    'listrik', 'token', 'token pln', 'token listrik', 'pln', 'tagihan listrik', 'bayar listrik',
    'air', 'pdam', 'tagihan air', 'pam', 'aetra', 'tirta',
    // Internet rumah
    'wifi', 'bayar wifi', 'indihome', 'biznet', 'firstmedia', 'first media', 'myrepublic', 'iconnet', 'xl home', 'orbit', 'cbn',
    // Rumah tangga pokok
    'galon', 'air galon', 'gas', 'gas lpg', 'lpg', 'tabung gas', 'gas 3kg', 'gas 12kg',
    'kos', 'kosan', 'sewa kos', 'bayar kos', 'kontrakan', 'sewa kontrakan', 'sewa rumah',
    'iuran rt', 'iuran rw', 'iuran sampah', 'iuran kebersihan', 'iuran keamanan', 'pbb'
  ],
  'Belanja Bulanan': [
    // Tempat belanja
    'indomaret', 'alfamart', 'alfamidi', 'superindo', 'hypermart', 'transmart', 'lottemart', 'pasar', 'kelontong', 'minimarket', 'supermarket',
    // Sembako
    'sembako', 'beras', 'minyak', 'minyak goreng', 'gula', 'garam', 'kecap', 'saos', 'bumbu', 'royco', 'masako',
    'tepung', 'terigu', 'bawang', 'cabai', 'cabe', 'tomat', 'mie kardus', 'kopi sachet',
    // Mandi & Kebersihan
    'sabun', 'sabun mandi', 'shampoo', 'sampo', 'odol', 'pepsodent', 'sikat gigi', 'pasta gigi', 'sabun cuci piring',
    'sunlight', 'mama lemon', 'deterjen', 'detergen', 'rinso', 'soklin', 'daia', 'pewangi', 'molto', 'downy',
    'pembersih lantai', 'wipol', 'superpell', 'bayclin', 'obat nyamuk', 'baygon', 'hit', 'kapur barus', 'stella',
    // Kebutuhan Rumah & Pribadi
    'tisu', 'tissue', 'kapas', 'deodoran', 'rexona', 'sabun muka', 'facial wash', 'skincare', 'sunscreen',
    'pembalut', 'pampers', 'popok', 'silet', 'cukuran', 'hanger', 'sapu', 'kain pel', 'keset', 'ember', 'gayung',
    'piring', 'sendok', 'garpu', 'baterai', 'lampu', 'bohlam', 'plastik', 'kresek', 'lakban', 'gunting',
    'potong rambut', 'cukur', 'barbershop', 'laundry', 'cuci baju', 'baju', 'kaos', 'celana', 'sandal', 'sepatu'
  ],
  'Kirim Keluarga': [
    'ortu', 'orang tua', 'ibu', 'mama', 'emak', 'bunda', 'umi', 'bapak', 'ayah', 'papa', 'abi', 'babeh',
    'adik', 'adek', 'kakak', 'abang', 'anak', 'istri', 'mertua', 'keluarga', 'saudara', 'famili',
    'kirim ortu', 'kirim keluarga', 'kirim ibu', 'kirim bapak', 'transfer ortu', 'transfer keluarga', 'transfer ibu',
    'uang jajan adik', 'spp adik', 'uang saku', 'nafkah', 'sedekah', 'infaq', 'zakat', 'donasi', 'sumbangan', 'kondangan', 'amplop'
  ],
  'Dana Darurat': [
    'darurat', 'emergency', 'sakit', 'berobat', 'dokter', 'klinik', 'puskesmas', 'rumah sakit', 'rs', 'ugd', 'igd',
    'obat', 'apotek', 'apotik', 'kimia farma', 'k24', 'panadol', 'paracetamol', 'bodrex', 'tolak angin',
    'tes darah', 'tensi', 'cek kesehatan', 'perban', 'betadine', 'plester', 'biaya darurat', 'pengeluaran darurat'
  ],
  'Tabungan': [
    'tabungan', 'nabung', 'simpanan', 'celengan', 'deposito', 'simpan uang', 'setor tabungan', 'sisihkan',
    'reksadana', 'saham', 'investasi', 'bibit', 'bareksa', 'ajaib', 'pluang', 'emas', 'logam mulia', 'antam',
    'seabank', 'sea bank'
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
 * Deteksi Kategori otomatis berdasarkan deskripsi teks dan nominal
 * DILARANG KERAS MENGEMBALIKAN 'Lain-lain'. Selalu dipetakan ke 10 kantong resmi pengguna.
 */
function detectCategory(text, type = 'expense', amount = 0) {
  if (type === 'income') return 'Gaji & Pemasukan';
  if (!text) return amount <= 35000 ? 'Makanan & Minuman' : 'Belanja Bulanan';

  const lower = text.toLowerCase().trim();

  // 1. Cek kecocokan langsung kata kunci (Exact substring match)
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        return category;
      }
    }
  }

  // 2. Token Matching (Pecah per kata)
  const tokens = lower.split(/[^a-zA-Z0-9]+/).filter((t) => t.length >= 3);
  for (const token of tokens) {
    for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      if (keywords.includes(token)) {
        return category;
      }
    }
  }

  // 3. Heuristic Rules (Karakteristik kata bahasa Indonesia)
  if (/makan|minum|pedas|manis|asin|goreng|bakar|rebus|kuah|paket|porsi|bungkus|resto|warung|kedai|dapur/i.test(lower)) {
    return 'Makanan & Minuman';
  }
  if (/rumah|kamar|kontrakan|iuran|tagihan|pln|pdam|wifi|lpg|gas/i.test(lower)) {
    return 'Listrik, Air & Wifi';
  }
  if (/motor|mobil|jalan|kendaraan|transport|ojek|supir|driver|bengkel|mesin|roda/i.test(lower)) {
    return 'Bensin & Transportasi';
  }
  if (/toko|beli|belanja|minimarket|swalayan|pasar|mall|barang|alat|peralatan|kebersihan/i.test(lower)) {
    return 'Belanja Bulanan';
  }
  if (/santai|main|kumpul|jalan|rekreasi|kafe|kopi/i.test(lower)) {
    return 'Nongkrong & Hiburan';
  }
  if (/ortu|keluarga|ibu|ayah|mama|papa|adik|kakak|anak|sedekah|infaq/i.test(lower)) {
    return 'Kirim Keluarga';
  }

  // 4. Default Fallback Cerdas (Tidak akan pernah keluar 'Lain-lain')
  if (amount > 0 && amount <= 35000) {
    return 'Makanan & Minuman';
  }
  return 'Belanja Bulanan';
}

/**
 * Deteksi dan Parse Transaksi Pemindahan Dana / Mutasi Antar Rekening & Kantong
 */
function parseFundTransfer(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  const text = rawText.trim();
  const lower = text.toLowerCase();

  // Kata kunci indikasi transfer/pemindahan dana
  const transferKeywords = ['pindah', 'pindahkan', 'transfer', 'alokasi', 'alokasikan', 'mutasi', 'masukkan saldo', 'masuk saldo'];
  const hasTransferKeyword = transferKeywords.some((kw) => lower.includes(kw));

  if (!hasTransferKeyword) return null;

  // Cek apakah hanya bertanya panduan ("pindahkan dana ini ke sini", "pindah dana", "cara pindah dana")
  const isQuestionOrGuide =
    lower === 'pindahkan dana ini ke sini' ||
    lower === 'pindah dana ini ke sini' ||
    lower === 'pindahkan dana' ||
    lower === 'pindah dana' ||
    lower === 'cara pindah dana' ||
    lower === 'panduan pindah dana' ||
    lower === 'mutasi dana' ||
    lower === 'alokasi dana' ||
    lower === 'transfer dana' ||
    lower === 'pindah saldo' ||
    lower.includes('cara pindah') ||
    lower.includes('cara transfer') ||
    lower.includes('pindahkan dana ini');

  // Ambil nominal jika ada
  const nominalRegex = /(?:rp\.?\s*)?([0-9]+(?:[.,][0-9]+)?\s*(?:jt|juta|rb|ribu|k)?|[0-9]{1,3}(?:\.[0-9]{3})+)/gi;
  const matchNominal = nominalRegex.exec(text);

  if (!matchNominal || isQuestionOrGuide) {
    return { isGuide: true };
  }

  const amount = parseNominal(matchNominal[1]);
  if (!amount || amount <= 0) {
    return { isGuide: true };
  }

  // Tentukan bank asal
  let fromBank = 'BSI';
  if (lower.includes('dari jago')) fromBank = 'Bank Jago';
  else if (lower.includes('dari seabank')) fromBank = 'SeaBank';
  else if (lower.includes('dari bsi')) fromBank = 'BSI';

  // Tentukan target transfer
  let toTarget = 'Bank Jago';
  let category = 'Belanja Bulanan';
  let transferType = 'bank_to_bank';

  if (lower.includes('seabank') || lower.includes('sea bank')) {
    toTarget = 'SeaBank';
    if (amount === 800000) {
      transferType = 'seabank_bundle'; // Otomatis split 500k darurat + 300k tabungan
      category = 'Tabungan';
    } else if (lower.includes('darurat')) {
      transferType = 'category_pocket';
      category = 'Dana Darurat';
    } else {
      transferType = 'category_pocket';
      category = 'Tabungan';
    }
  } else if (lower.includes('ortu') || lower.includes('orang tua') || lower.includes('ibu') || lower.includes('bapak') || lower.includes('mama') || lower.includes('keluarga')) {
    toTarget = 'Orang Tua / Keluarga';
    category = 'Kirim Keluarga';
    transferType = 'category_pocket';
  } else if (lower.includes('darurat') || lower.includes('emergency')) {
    toTarget = 'Dana Darurat';
    category = 'Dana Darurat';
    transferType = 'category_pocket';
  } else if (lower.includes('tabung') || lower.includes('investasi') || lower.includes('bibit')) {
    toTarget = 'Tabungan & Investasi';
    category = 'Tabungan';
    transferType = 'category_pocket';
  } else if (lower.includes('makan')) {
    toTarget = 'Kantong Uang Makan';
    category = 'Makanan & Minuman';
    transferType = 'category_pocket';
  } else if (lower.includes('rokok') || lower.includes('vape')) {
    toTarget = 'Kantong Rokok & Vape';
    category = 'Rokok & Vape';
    transferType = 'category_pocket';
  } else if (lower.includes('nongkrong') || lower.includes('kopi')) {
    toTarget = 'Kantong Nongkrong & Kopi';
    category = 'Nongkrong & Hiburan';
    transferType = 'category_pocket';
  } else if (lower.includes('bensin') || lower.includes('transport')) {
    toTarget = 'Kantong Bensin & Transportasi';
    category = 'Bensin & Transportasi';
    transferType = 'category_pocket';
  } else if (lower.includes('listrik') || lower.includes('wifi') || lower.includes('air') || lower.includes('tagihan')) {
    toTarget = 'Kantong Tagihan (Listrik/Wifi)';
    category = 'Listrik, Air & Wifi';
    transferType = 'category_pocket';
  } else if (lower.includes('kuota') || lower.includes('pulsa')) {
    toTarget = 'Kantong Kuota & Internet';
    category = 'Kuota & Internet';
    transferType = 'category_pocket';
  } else if (lower.includes('sembako') || lower.includes('belanja')) {
    toTarget = 'Kantong Belanja Sembako';
    category = 'Belanja Bulanan';
    transferType = 'category_pocket';
  } else if (lower.includes('jago') || lower.includes('bank jago')) {
    toTarget = 'Bank Jago';
    transferType = 'bank_to_bank';
  }

  return {
    isTransfer: true,
    amount,
    fromBank,
    toTarget,
    category,
    transferType,
    rawText: text,
  };
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
    const category = detectCategory(description, type, parsedAmount);

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

  // 0. Cek Pola Transfer / Pemindahan Dana Antar Bank & Kantong
  const fundTransfer = parseFundTransfer(text);
  if (fundTransfer) {
    if (fundTransfer.isGuide) {
      return { isCommand: true, action: 'fund_transfer_guide' };
    }
    return {
      isCommand: false,
      isTransfer: true,
      data: fundTransfer,
    };
  }

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
    lower === 'simulasi alokasi 22' ||
    lower === 'alokasi 22' ||
    lower === 'simulasi alokasi' ||
    lower === 'tes alokasi' ||
    lower === 'pengingat alokasi' ||
    lower === 'reminder alokasi' ||
    lower === 'notifikasi 22' ||
    lower === 'reminder 22' ||
    lower === 'jadwal alokasi'
  ) {
    return { isCommand: true, action: 'trigger_allocation_reminder_22' };
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

  if (
    lower === 'restart keuangan' ||
    lower === 'reset keuangan' ||
    lower === 'reset data' ||
    lower === 'reset transaksi' ||
    lower === 'hapus semua data' ||
    lower === 'hapus semua transaksi'
  ) {
    return { isCommand: true, action: 'reset_all_data' };
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
