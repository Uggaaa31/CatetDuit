// Uji regresi parser pesan. Jalankan: node test/parser.test.js  (atau: npm test)
// Tidak butuh database maupun dependency tambahan.
'use strict';

const assert = require('assert');
const { parseMessage, parseNominal, detectCategory, countNominals } = require('../src/services/nlpParser');

let pass = 0;
const cases = [];

function it(label, fn) {
  cases.push({ label, fn });
}

// --- nominal ---
it('parseNominal: 25rb', () => assert.strictEqual(parseNominal('25rb'), 25000));
it('parseNominal: 1,5jt', () => assert.strictEqual(parseNominal('1,5jt'), 1500000));
it('parseNominal: 50.000', () => assert.strictEqual(parseNominal('50.000'), 50000));
it('parseNominal: 50.000,50 (desimal Indonesia)', () => assert.strictEqual(parseNominal('50.000,50'), 50000));

// --- kategori ---
it('detectCategory: bensin', () => assert.strictEqual(detectCategory('bensin 50rb', 'expense', 50000), 'Bensin & Transportasi'));
it('detectCategory: sabun mandi', () => assert.strictEqual(detectCategory('sabun mandi 25rb', 'expense', 25000), 'Belanja Bulanan'));

// --- transaksi tunggal & multi ---
it('multi-item dipisah koma', () => {
  const r = parseMessage('makan 25rb, es teh 5rb, parkir 2rb');
  assert.strictEqual(r.items.length, 3);
  assert.strictEqual(r.items[2].category, 'Bensin & Transportasi');
});

it('pemasukan dengan awalan +', () => {
  const r = parseMessage('+gaji 6.5jt');
  assert.strictEqual(r.items[0].type, 'income');
  assert.strictEqual(r.items[0].amount, 6500000);
});

// --- REGRESI: merchant + nominal + kata tanggal tidak boleh menghilangkan transaksi ---
it('"jajan di kantin 15rb kemarin" tetap tercatat', () => {
  const r = parseMessage('jajan di kantin 15rb kemarin');
  assert.ok(r.isTransaction, 'harus dikenali sebagai transaksi');
  assert.strictEqual(r.items[0].amount, 15000);
  assert.strictEqual(r.items[0].merchantName, 'kantin');
  assert.ok(r.items[0].customDate, 'tanggal harus terisi');
});

it('"makan 25rb di warteg kemarin" merchant bersih dari kata tanggal', () => {
  const r = parseMessage('makan 25rb di warteg kemarin');
  assert.strictEqual(r.items[0].merchantName, 'warteg');
  assert.strictEqual(r.items[0].description, 'makan');
});

it('"belanja di alfamart 150rb kemarin" tetap tercatat', () => {
  const r = parseMessage('belanja di alfamart 150rb kemarin');
  assert.ok(r.isTransaction);
  assert.strictEqual(r.items[0].amount, 150000);
});

// --- REGRESI: routing transfer vs pergeseran anggaran ---
it('"pindah 800rb ke seabank" = bundle SeaBank', () => {
  const r = parseMessage('pindah 800rb ke seabank');
  assert.strictEqual(r.data.transferType, 'seabank_bundle');
});

it('"pindah 800rb ke seabank dari BSI" tetap transfer (bukan geser kantong)', () => {
  const r = parseMessage('pindah 800rb ke seabank dari BSI');
  assert.ok(!r.isPocketShift, 'tidak boleh dianggap pergeseran kantong');
  assert.strictEqual(r.data.transferType, 'seabank_bundle');
});

it('"pindahkan 400rb dari jago ke ortu" = transfer kirim keluarga', () => {
  const r = parseMessage('pindahkan 400rb dari jago ke ortu');
  assert.ok(!r.isPocketShift);
  assert.strictEqual(r.data.category, 'Kirim Keluarga');
});

it('"transfer 150rb ke Budi" = person_transfer (harus tercatat)', () => {
  const r = parseMessage('transfer 150rb ke Budi');
  assert.strictEqual(r.data.transferType, 'person_transfer');
  assert.strictEqual(r.data.toTarget, 'Budi');
});

it('"13k pindahkan ke makanan dari uang bulanan" = pergeseran kantong', () => {
  const r = parseMessage('13k pindahkan ke makanan dari uang bulanan');
  assert.ok(r.isPocketShift);
  assert.strictEqual(r.data.amount, 13000);
});

// --- perintah ---
it('perintah tagihan dikenali', () => {
  assert.strictEqual(parseMessage('tagihan').action, 'list_bills');
  assert.strictEqual(parseMessage('tambah tagihan wifi 350rb tgl 15').action, 'add_bill');
  assert.strictEqual(parseMessage('bayar tagihan wifi').action, 'pay_bill');
  assert.strictEqual(parseMessage('hapus tagihan wifi').action, 'remove_bill');
});

it('perintah dasar lain dikenali', () => {
  assert.strictEqual(parseMessage('rekap bulan ini').action, 'rekap');
  assert.strictEqual(parseMessage('batal').action, 'undo');
  assert.strictEqual(parseMessage('budget').action, 'budget');
});

// --- countNominals: penentu jalur cepat (regex) vs AI ---
it('countNominals: tiga nominal di satu pesan', () => {
  assert.strictEqual(countNominals('makan 25rb, es teh 5rb, parkir 2rb'), 3);
});

it('countNominals: tanggal & kuantitas tidak dihitung', () => {
  assert.strictEqual(countNominals('isi bensin 30rb tanggal 21'), 1);
  assert.strictEqual(countNominals('beli 2 porsi nasi goreng 50rb'), 1);
});

it('countNominals: dua nominal walau tanpa koma', () => {
  assert.strictEqual(countNominals('tadi makan sate 45rb terus beli rokok 35rb'), 2);
});

// --- aturan kategori pribadi & insight ---
it('perintah aturan kategori pribadi dikenali', () => {
  const add = parseMessage('kalau aku bilang ngopi masuk nongkrong');
  assert.strictEqual(add.action, 'add_rule');
  assert.strictEqual(add.keyword, 'ngopi');
  assert.strictEqual(add.categoryInput, 'nongkrong');
  assert.strictEqual(parseMessage('hapus aturan ngopi').action, 'remove_rule');
  assert.strictEqual(parseMessage('daftar aturan').action, 'list_rules');
});

it('perintah insight dikenali', () => {
  assert.strictEqual(parseMessage('insight').action, 'trigger_weekly_insight');
});

it('pesan transaksi tidak salah dibaca sebagai aturan', () => {
  assert.ok(parseMessage('bakso 25rb').isTransaction, 'harus tetap transaksi');
});

it('perintah budget dan jatah hari ini dikenali', () => {
  assert.strictEqual(parseMessage('budget hari ini').action, 'today_budget');
  assert.strictEqual(parseMessage('sisa hari ini').action, 'today_budget');
  assert.strictEqual(parseMessage('jatah hari ini').action, 'today_budget');
  const cat1 = parseMessage('jatah makan hari ini');
  assert.strictEqual(cat1.action, 'today_budget');
  assert.strictEqual(cat1.categoryInput, 'makan');
  const cat2 = parseMessage('sisa rokok hari ini');
  assert.strictEqual(cat2.action, 'today_budget');
  assert.strictEqual(cat2.categoryInput, 'rokok');
  assert.ok(parseMessage('makan 25rb hari ini').isTransaction, 'transaksi dengan nominal tetap transaksi');
});

// --- runner ---
let failed = 0;
for (const c of cases) {
  try {
    c.fn();
    pass++;
    console.log(`  ok    ${c.label}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${c.label}`);
    console.log(`        ${err.message}`);
  }
}

console.log(`\n${pass} lulus, ${failed} gagal`);
process.exit(failed ? 1 : 0);