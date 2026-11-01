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
    'lucky strike', 'diplomat', 'wismilak', 'forte', 'rokok sin', 'rokok win', 'scorpion', 'apache',
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

  // 1. Cek Kata Kunci dengan Word Boundary & Prioritaskan Keyword Terpanjang (Longest Match)
  // Menghindari substring false match (misal: 'sin' di dalam 'bensin' tidak boleh mencocokkan 'Rokok')
  let bestMatchCategory = null;
  let maxKeywordLength = 0;

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      const escapedKw = kw.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
      // Pastikan kata berdiri sendiri (dikelilingi spasi/tanda baca/awal/akhir teks, bukan bagian dari kata lain)
      const regex = new RegExp(`(?:^|[^a-z0-9])${escapedKw}(?:[^a-z0-9]|$)`, 'i');
      if (regex.test(lower)) {
        if (kw.length > maxKeywordLength) {
          maxKeywordLength = kw.length;
          bestMatchCategory = category;
        }
      }
    }
  }

  if (bestMatchCategory) {
    return bestMatchCategory;
  }

  // 2. Heuristic Rules (Karakteristik kata bahasa Indonesia)
  if (/\b(?:makan|minum|pedas|manis|asin|goreng|bakar|rebus|kuah|paket|porsi|bungkus|resto|warung|kedai|dapur)\b/i.test(lower)) {
    return 'Makanan & Minuman';
  }
  if (/\b(?:rumah|kamar|kontrakan|iuran|tagihan|pln|pdam|wifi|lpg|gas)\b/i.test(lower)) {
    return 'Listrik, Air & Wifi';
  }
  if (/\b(?:motor|mobil|jalan|kendaraan|transport|ojek|supir|driver|bengkel|mesin|roda)\b/i.test(lower)) {
    return 'Bensin & Transportasi';
  }
  if (/\b(?:toko|beli|belanja|minimarket|swalayan|pasar|mall|barang|alat|peralatan|kebersihan)\b/i.test(lower)) {
    return 'Belanja Bulanan';
  }
  if (/\b(?:santai|main|kumpul|jalan|rekreasi|kafe|kopi)\b/i.test(lower)) {
    return 'Nongkrong & Hiburan';
  }
  if (/\b(?:ortu|keluarga|ibu|ayah|mama|papa|adik|kakak|anak|sedekah|infaq)\b/i.test(lower)) {
    return 'Kirim Keluarga';
  }

  // 3. Default Fallback Cerdas
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
 * Parse perintah pergeseran / pemindahan anggaran antar kantong
 * Contoh:
 * - "tolong 13k itu pindahkan ke dompet makanan dari uang bulanan"
 * - "pindahkan 13k ke dompet makanan dari uang bulanan"
 * - "geser 50rb dari jatah rokok ke uang makan"
 * - "pindah 20rb ke makanan dari bulanan"
 */
function parsePocketShift(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  const lower = rawText.trim().toLowerCase();

  if (!/(?:pindah|pindahkan|geser|alihkan|transfer|oper)/i.test(lower)) {
    return null;
  }

  if (!lower.includes('dari') || (!lower.includes('ke') && !lower.includes('untuk'))) {
    return null;
  }

  const p1 = /(?:tolong\s+)?([0-9]+(?:[.,][0-9]+)?\s*(?:jt|juta|rb|ribu|k)?|[0-9]{1,3}(?:\.[0-9]{3})+)\s*(?:itu\s+)?(?:tolong\s+)?(?:pindah|pindahkan|geser|alihkan|transfer|oper)\s+(?:ke|untuk)\s+([a-z0-9\s,&]+)\s+dari\s+([a-z0-9\s,&]+)/i;
  const p2 = /(?:tolong\s+)?(?:pindah|pindahkan|geser|alihkan|transfer|oper)\s+(?:dana\s+|uang\s+|budget\s+|anggaran\s+)?([0-9]+(?:[.,][0-9]+)?\s*(?:jt|juta|rb|ribu|k)?|[0-9]{1,3}(?:\.[0-9]{3})+)\s+(?:ke|untuk)\s+([a-z0-9\s,&]+)\s+dari\s+([a-z0-9\s,&]+)/i;
  const p3 = /(?:tolong\s+)?(?:pindah|pindahkan|geser|alihkan|transfer|oper)\s+(?:dana\s+|uang\s+|budget\s+|anggaran\s+)?([0-9]+(?:[.,][0-9]+)?\s*(?:jt|juta|rb|ribu|k)?|[0-9]{1,3}(?:\.[0-9]{3})+)\s+dari\s+([a-z0-9\s,&]+)\s+(?:ke|untuk)\s+([a-z0-9\s,&]+)/i;

  let match = lower.match(p1);
  if (match) {
    const amount = parseNominal(match[1]);
    const toPocket = match[2].trim();
    const fromPocket = match[3].trim();
    if (amount > 0 && toPocket && fromPocket) {
      return { isPocketShift: true, amount, toPocket, fromPocket, rawText };
    }
  }

  match = lower.match(p2);
  if (match) {
    const amount = parseNominal(match[1]);
    const toPocket = match[2].trim();
    const fromPocket = match[3].trim();
    if (amount > 0 && toPocket && fromPocket) {
      return { isPocketShift: true, amount, toPocket, fromPocket, rawText };
    }
  }

  match = lower.match(p3);
  if (match) {
    const amount = parseNominal(match[1]);
    const fromPocket = match[2].trim();
    const toPocket = match[3].trim();
    if (amount > 0 && toPocket && fromPocket) {
      return { isPocketShift: true, amount, toPocket, fromPocket, rawText };
    }
  }

  return null;
}

function extractCustomDate(text) {
  if (!text) return null;
  const now = new Date();
  const lower = text.toLowerCase();

  // 1. Relatif: kemarin / kemaren
  if (/\bkemarin\b|\bkemaren\b/i.test(lower)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    d.setHours(12, 0, 0, 0);
    return d;
  }

  // 2. Relatif: tadi / barusan / tadi pagi / tadi siang / tadi malam (= hari ini)
  if (/\btadi\b|\bbarusan\b|\bhabis\b|\babis\b/i.test(lower)) {
    const d = new Date(now);
    d.setHours(12, 0, 0, 0);
    return d;
  }

  // 3. Relatif dengan hari: 2 hari lalu, 3 hari yang lalu, beberapa hari lalu
  const daysAgoMatch = lower.match(/([0-9]+|beberapa|dua|tiga|empat|lima|seminggu)\s*hari\s*(?:yang\s+)?lalu/i);
  if (daysAgoMatch) {
    const wordMap = { beberapa: 3, dua: 2, tiga: 3, empat: 4, lima: 5, seminggu: 7 };
    const daysBack = parseInt(daysAgoMatch[1], 10) || wordMap[daysAgoMatch[1].toLowerCase()] || 3;
    const d = new Date(now);
    d.setDate(d.getDate() - daysBack);
    d.setHours(12, 0, 0, 0);
    return d;
  }

  // 4. Relatif: minggu lalu
  if (/\bminggu\s+lalu\b/i.test(lower)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 7);
    d.setHours(12, 0, 0, 0);
    return d;
  }

  // 5. Nama hari dalam seminggu: Senin, Selasa, Rabu, Kamis, Jumat, Sabtu, Minggu
  const hariMap = {
    senin: 1, selasa: 2, rabu: 3, kamis: 4, jumat: 5, sabtu: 6, minggu: 0,
    monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 0,
  };
  const hariMatch = lower.match(/\b(hari\s+)?(senin|selasa|rabu|kamis|jumat|sabtu|minggu|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (hariMatch) {
    const targetDay = hariMap[hariMatch[2].toLowerCase()];
    const d = new Date(now);
    let diff = d.getDay() - targetDay;
    if (diff <= 0) diff += 7; // Ambil yang lalu
    d.setDate(d.getDate() - diff);
    d.setHours(12, 0, 0, 0);
    return d;
  }

  // 6. Format: 'tanggal 21', 'tgl 21', 'tanggal 21/10', 'tanggal 21-10-2026'
  const tglMatch = text.match(/(?:pada\s+)?(?:tanggal|tgl)\s*([0-9]{1,2})(?:\s*[-/]\s*([0-9]{1,2}))?(?:\s*[-/]\s*([0-9]{2,4}))?/i);
  if (tglMatch) {
    const day = parseInt(tglMatch[1], 10);
    if (day >= 1 && day <= 31) {
      let month = now.getMonth();
      let year = now.getFullYear();
      if (tglMatch[2]) {
        // Bulan eksplisit: gunakan apa adanya
        month = parseInt(tglMatch[2], 10) - 1;
      } else {
        // Bulan tidak disebutkan: jika tanggal masih di depan (belum lewat), pakai bulan lalu
        if (day > now.getDate()) {
          month = now.getMonth() - 1;
          if (month < 0) { month = 11; year -= 1; }
        }
      }
      if (tglMatch[3]) {
        year = parseInt(tglMatch[3], 10);
        if (year < 100) year += 2000;
      }
      return new Date(year, month, day, 12, 0, 0);
    }
  }

  // 7. Format tanggal langsung: 21/10, 21-10, 21/10/2026
  const shortDateMatch = text.match(/\b([0-9]{1,2})[\/\-]([0-9]{1,2})(?:[\/\-]([0-9]{2,4}))?\b/);
  if (shortDateMatch) {
    const day = parseInt(shortDateMatch[1], 10);
    const month = parseInt(shortDateMatch[2], 10) - 1;
    let year = now.getFullYear();
    if (shortDateMatch[3]) {
      year = parseInt(shortDateMatch[3], 10);
      if (year < 100) year += 2000;
    }
    if (day >= 1 && day <= 31 && month >= 0 && month <= 11) {
      return new Date(year, month, day, 12, 0, 0);
    }
  }

  return null;
}

/**
 * Ekstrak item-item transaksi dari string teks
 * Mendukung single item maupun multi-item (dipisahkan baris baru, koma non-desimal, atau kata hubung)
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

  // 1. Lindungi tanggal, jam, dan kuantitas agar angkanya TIDAK dianggap sebagai uang/nominal
  const protectedTokens = [];
  function protect(val) {
    const token = `__TOKEN_${protectedTokens.length}__`;
    protectedTokens.push(val);
    return token;
  }

  // Tanggal: 'pada tanggal 21', 'tgl 21', 'tanggal 21/10', 'tanggal 21 okt'
  workingText = workingText.replace(/(?:pada\s+)?(?:tanggal|tgl)\s*([0-9]{1,2}(?:\s*(?:[-/]\s*[0-9]{1,2}(?:\s*[-/]\s*[0-9]{2,4})?|[a-zA-Z]+))?)/gi, (m) => protect(m));

  // Kata relatif tanggal: 'kemarin', 'tadi', 'barusan', 'habis', '2 hari lalu', 'minggu lalu'
  // HARUS dilindungi SEBELUM nominalRegex agar angkanya tidak dianggap nominal
  workingText = workingText.replace(/\b[0-9]+\s*hari\s*(?:yang\s+)?lalu\b/gi, (m) => protect(m));
  workingText = workingText.replace(/\bminggu\s+lalu\b/gi, (m) => protect(m));
  workingText = workingText.replace(/\b(?:kemarin|kemaren)\b/gi, (m) => protect(m));
  workingText = workingText.replace(/\btadi\s*(?:pagi|siang|sore|malam)?\b/gi, (m) => protect(m));
  workingText = workingText.replace(/\b(?:barusan|habis|abis)\b/gi, (m) => protect(m));
  // Nama hari: 'Senin', 'hari Jumat', dst
  workingText = workingText.replace(/\b(?:hari\s+)?(?:senin|selasa|rabu|kamis|jumat|sabtu|minggu)\b/gi, (m) => protect(m));

  // Jam / waktu: 'jam 13:00', 'pukul 21'
  workingText = workingText.replace(/(?:jam|pukul)\s*([0-9]{1,2}(?:[:.][0-9]{2})?)/gi, (m) => protect(m));

  // Kuantitas: '2 porsi', '3 bungkus', '10 pcs'
  workingText = workingText.replace(/([0-9]+)\s*(porsi|bungkus|buah|botol|kotak|gelas|butir|lembar|biji|pcs|pack|sachet|kaleng|piring)/gi, (m) => protect(m));

  // Regex nominal yang akurat:
  // 1. Ada simbol rp / idr
  // 2. Ada suffix satuan: jt, juta, rb, ribu, k
  // 3. Format ribuan bertitik: 50.000, 1.500.000
  // 4. Angka polos minimal 3 digit (>= 100): 500, 2000, 25000 (bukan angka 1 digit/2 digit)
  const nominalRegex = /(?:(?:rp\.?|idr)\s*[0-9]+(?:[.,][0-9]+)?(?:\s*(?:jt|juta|rb|ribu|k))?|[0-9]+(?:[.,][0-9]+)?\s*(?:jt|juta|rb|ribu|k)|[0-9]{1,3}(?:\.[0-9]{3})+|\b[1-9][0-9]{2,}\b)/gi;
  const allNominalMatches = workingText.match(nominalRegex) || [];

  if (allNominalMatches.length === 0) {
    return [];
  }

  let candidateChunks = [workingText];

  // Jika ada lebih dari 1 nominal, lakukan pembagian berdasarkan delimiter
  if (allNominalMatches.length > 1) {
    if (workingText.includes('\n')) {
      candidateChunks = workingText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    } else if (workingText.includes(';') || /(?<!\d),(?!\d)/.test(workingText)) {
      // Split koma HANYA jika bukan koma desimal (contoh '4,1 jt' komanya dilindungi)
      candidateChunks = workingText.split(/(?<!\d),(?!\d)|;+/).map((s) => s.trim()).filter(Boolean);
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

  function restoreTokens(str) {
    let res = str;
    for (let i = 0; i < protectedTokens.length; i++) {
      res = res.replace(new RegExp(`__TOKEN_${i}__`, 'g'), protectedTokens[i]);
    }
    return res;
  }

  const items = [];
  for (const chunk of candidateChunks) {
    // Hanya hapus bullet number seperti '1. ' atau '1) ' atau '- '
    let itemText = chunk.replace(/^(?:[-•*]|\d+[\.\)])\s*/, '').trim();
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

    const parsedAmount = parseNominal(match[0]);
    if (!parsedAmount || parsedAmount <= 0) continue;

    let description = itemText.replace(match[0], '').trim();
    description = description.replace(/^[-–—:]\s*/, '').replace(/\s*[-–—:]$/, '').trim();

    let merchantName = globalMerchant;
    const diTokoMatch = description.match(/(?:\s+(?:di|ke|@)\s+)([A-Za-z0-9\s.\-]{2,40})$/i);
    if (diTokoMatch) {
      merchantName = diTokoMatch[1].trim();
      description = description.substring(0, diTokoMatch.index).trim();
    }

    // Kembalikan token asli (misal: 'pada tanggal 21')
    description = restoreTokens(description).trim();

    // Deteksi tanggal kustom dari deskripsi (sudah direstorasi) atau teks asli
    const customDate = extractCustomDate(description) || extractCustomDate(text);

    // Hapus frasa tanggal/waktu relatif dari deskripsi agar tidak masuk nama transaksi
    // Urutan penting: dari yang paling spesifik ke paling umum
    description = description.replace(/(?:pada\s+)?(?:tanggal|tgl)\s*[0-9]{1,2}(?:\s*[-/]\s*[0-9]{1,2}(?:\s*[-/]\s*[0-9]{2,4})?)?/gi, '');
    description = description.replace(/\b[0-9]{1,2}[\/\-][0-9]{1,2}(?:[\/\-][0-9]{2,4})?\b/g, '');
    description = description.replace(/\b[0-9]+\s*hari\s*(?:yang\s+)?lalu\b/gi, '');
    description = description.replace(/\bminggu\s+lalu\b/gi, '');
    description = description.replace(/\b(?:kemarin|kemaren)\b/gi, '');
    description = description.replace(/\btadi\s*(?:pagi|siang|sore|malam)?\b/gi, '');
    description = description.replace(/\b(?:barusan|habis|abis)\b/gi, '');
    description = description.replace(/\b(?:hari\s+)?(?:senin|selasa|rabu|kamis|jumat|sabtu|minggu)\b/gi, '');
    // Bersihkan spasi berlebih dan tanda baca di ujung
    description = description.replace(/\s{2,}/g, ' ').replace(/^[-–—:\s]+|[-–—:\s]+$/g, '').trim();

    if (!description) {
      description = isIncome ? 'Pemasukan' : 'Pengeluaran';
    } else if (isIncome && !description.toLowerCase().includes('pemasukan') && !description.toLowerCase().includes('gaji')) {
      description = `Pemasukan ${description}`;
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
      customDate: customDate || null,
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

  // 0a. Cek Pergeseran Anggaran Antar Kantong (Pocket Shift)
  const pocketShift = parsePocketShift(text);
  if (pocketShift) {
    return {
      isCommand: false,
      isPocketShift: true,
      data: pocketShift,
    };
  }

  // 0b. Cek Pola Transfer / Pemindahan Dana Antar Bank & Kantong
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
    return { isCommand: true, action: 'request_reset_all_data' };
  }

  if (
    lower === 'konfirmasi restart' ||
    lower === 'konfirmasi reset' ||
    lower === 'ya restart' ||
    lower === 'lanjut restart'
  ) {
    return { isCommand: true, action: 'confirm_reset_all_data' };
  }

  // --- Edit Transaksi (Quick Edit Terakhir & Targeted Edit Berdasarkan Kata Kunci / Bulan) ---

  // 1. Targeted Edit Kategori Berdasarkan Kata Kunci / Bulan
  // Pola A: "Belanja bulanan galon oktober ubah kategori ke makanan dan minuman" / "galon ubah kategori ke makanan"
  const editTargetedCatMatchA = text.match(/^(?:tolong\s+)?(.+?)\s+(?:tolong\s+)?(?:ubah|ganti|edit)\s+kategori(?:\s+transaksi)?\s+(?:jadi|ke|menjadi)\s+([a-zA-Z0-9\s,&]+)$/i);
  if (editTargetedCatMatchA) {
    const query = editTargetedCatMatchA[1].trim();
    const catInput = editTargetedCatMatchA[2].trim();
    // Pastikan query bukan kata kosong atau hanya "transaksi"
    if (query && !['transaksi', 'catatan', 'ini', 'itu'].includes(query.toLowerCase())) {
      return { isCommand: true, action: 'edit_tx_category_by_query', query, categoryInput: catInput };
    }
  }

  // Pola B: "ubah kategori galon oktober ke makanan dan minuman" / "ubah kategori galon jadi makanan"
  const editTargetedCatMatchB = text.match(/^(?:tolong\s+)?(?:ubah|ganti|edit)\s+kategori(?:\s+transaksi)?\s+(.+?)\s+(?:jadi|ke|menjadi)\s+([a-zA-Z0-9\s,&]+)$/i);
  if (editTargetedCatMatchB) {
    const query = editTargetedCatMatchB[1].trim();
    const catInput = editTargetedCatMatchB[2].trim();
    if (query && !['transaksi', 'catatan', 'ini', 'itu'].includes(query.toLowerCase())) {
      return { isCommand: true, action: 'edit_tx_category_by_query', query, categoryInput: catInput };
    }
  }

  // 2. Quick Edit Kategori Transaksi Terakhir: "ubah kategori makanan & minuman" / "ubah kategori ke bensin"
  const editCategoryMatch = text.match(/^(?:tolong\s+)?(?:ubah|ganti|edit)\s+kategori(?:\s+transaksi)?\s+(?:jadi\s+|menjadi\s+|ke\s+)?([a-zA-Z0-9\s,&]+)$/i);
  if (editCategoryMatch) {
    return { isCommand: true, action: 'edit_last_tx', field: 'category', value: editCategoryMatch[1].trim() };
  }

  // 3. Quick Edit Nominal Transaksi Terakhir
  const editNominalMatch = text.match(/^(?:ubah|ganti|edit)\s+nominal\s+(?:jadi\s+|menjadi\s+)?([0-9]+(?:[.,][0-9]+)?\s*(?:jt|juta|rb|ribu|k)?|[0-9]{1,3}(?:\.[0-9]{3})+)$/i);
  if (editNominalMatch) {
    const newAmount = parseNominal(editNominalMatch[1]);
    if (newAmount && newAmount > 0) {
      return { isCommand: true, action: 'edit_last_tx', field: 'amount', value: newAmount };
    }
  }

  const editDescMatch = text.match(/^(?:ubah|ganti|edit)\s+(?:keterangan|catatan|deskripsi)\s+(?:jadi\s+|menjadi\s+)?(.+)$/i);
  if (editDescMatch) {
    return { isCommand: true, action: 'edit_last_tx', field: 'description', value: editDescMatch[1].trim() };
  }

  const editMerchantMatch = text.match(/^(?:ubah|ganti|edit)\s+(?:toko|merchant)\s+(?:jadi\s+|menjadi\s+)?(.+)$/i);
  if (editMerchantMatch) {
    return { isCommand: true, action: 'edit_last_tx', field: 'merchantName', value: editMerchantMatch[1].trim() };
  }

  // --- Tagihan Rutin & Subscription ---
  if (lower === 'tagihan' || lower === 'daftar tagihan' || lower === 'cek tagihan' || lower === 'langganan') {
    return { isCommand: true, action: 'list_bills' };
  }

  const addBillMatch = text.match(/^(?:tambah|buat|add)\s+tagihan\s+([A-Za-z0-9\s.&-]+?)\s+([0-9]+(?:[.,][0-9]+)?\s*(?:jt|juta|rb|ribu|k)?|[0-9]{1,3}(?:\.[0-9]{3})+)\s+(?:tgl|tanggal)?\s*([0-9]{1,2})$/i);
  if (addBillMatch) {
    const billName = addBillMatch[1].trim();
    const billAmount = parseNominal(addBillMatch[2]);
    const billDueDay = parseInt(addBillMatch[3], 10);
    if (billAmount && billDueDay >= 1 && billDueDay <= 31) {
      return { isCommand: true, action: 'add_bill', name: billName, amount: billAmount, dueDay: billDueDay };
    }
  }

  const payBillMatch = text.match(/^bayar\s+tagihan\s+(.+)$/i);
  if (payBillMatch) {
    return { isCommand: true, action: 'pay_bill', name: payBillMatch[1].trim() };
  }

  const removeBillMatch = text.match(/^hapus\s+tagihan\s+(.+)$/i);
  if (removeBillMatch) {
    return { isCommand: true, action: 'remove_bill', name: removeBillMatch[1].trim() };
  }

  // --- Hutang & Piutang ---
  if (
    lower === 'hutang' ||
    lower === 'piutang' ||
    lower === 'cek hutang' ||
    lower === 'cek piutang' ||
    lower === 'buku hutang' ||
    lower === 'daftar hutang'
  ) {
    return { isCommand: true, action: 'list_debts' };
  }

  // Piutang (orang pinjam ke kita)
  const loanMatch = text.match(/^(?:pinjamkan|kasih\s+pinjam|piutang)\s+([a-zA-Z\s]+?)\s+([0-9]+(?:[.,][0-9]+)?\s*(?:jt|juta|rb|ribu|k)?|[0-9]{1,3}(?:\.[0-9]{3})+)(?:\s+(.+))?$/i);
  if (loanMatch) {
    const personName = loanMatch[1].trim();
    const loanAmount = parseNominal(loanMatch[2]);
    const loanDesc = loanMatch[3] ? loanMatch[3].trim() : '';
    if (loanAmount && loanAmount > 0) {
      return { isCommand: true, action: 'add_debt', debtType: 'loan', personName, amount: loanAmount, description: loanDesc };
    }
  }

  // Hutang (kita pinjam ke orang)
  const debtMatch = text.match(/^(?:hutang\s+(?:ke\s+)?|pinjam\s+(?:dari\s+|ke\s+)?)([a-zA-Z\s]+?)\s+([0-9]+(?:[.,][0-9]+)?\s*(?:jt|juta|rb|ribu|k)?|[0-9]{1,3}(?:\.[0-9]{3})+)(?:\s+(.+))?$/i);
  if (debtMatch) {
    const personName = debtMatch[1].trim();
    const debtAmount = parseNominal(debtMatch[2]);
    const debtDesc = debtMatch[3] ? debtMatch[3].trim() : '';
    if (debtAmount && debtAmount > 0) {
      return { isCommand: true, action: 'add_debt', debtType: 'debt', personName, amount: debtAmount, description: debtDesc };
    }
  }

  // Pelunasan hutang / piutang
  const settleMatch = text.match(/^(?:lunas\s+(?:hutang|piutang)?\s*([a-zA-Z\s]+)|([a-zA-Z\s]+)\s+lunas)$/i);
  if (settleMatch) {
    const personName = (settleMatch[1] || settleMatch[2]).trim();
    if (personName && !['semua', 'tagihan'].includes(personName.toLowerCase())) {
      return { isCommand: true, action: 'settle_debt', personName };
    }
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

function isConversationalText(rawText) {
  if (!rawText || typeof rawText !== 'string') return false;
  const text = rawText.trim().toLowerCase();

  const conversationalKeywords = [
    'tadi', 'kemarin', 'kemaren', 'barusan', 'abis', 'habis', 'lagi',
    'gue', 'gw', 'aku', 'saya', 'kita', 'kami', 'lu', 'kamu', 'doi',
    'terus', 'lalu', 'sekalian', 'mampir', 'bareng', 'sama',
    'dong', 'deh', 'sih', 'nih', 'tuh', 'ya', 'kan',
    'halo', 'hai', 'pagi', 'siang', 'sore', 'malam', 'assalamualaikum',
    'gimana', 'bagaimana', 'kenapa', 'mengapa', 'berapa', 'kira-kira',
    'bisa', 'tolong', 'bantu', 'makasih', 'terima kasih',
    'nongki', 'ngopi', 'curhat', 'beliin', 'kirimin', 'transferin'
  ];

  const words = text.split(/\s+/).filter(Boolean);

  const hasConvWord = words.some((w) => conversationalKeywords.includes(w.replace(/[^a-z]/g, '')));
  if (hasConvWord) return true;

  if (words.length >= 5 && !text.includes(',')) return true;

  if (text.includes('?')) return true;

  return false;
}

module.exports = {
  parseMessage,
  parseNominal,
  detectCategory,
  extractTransactionItems,
  CATEGORY_KEYWORDS,
  isConversationalText,
  parsePocketShift,
};

