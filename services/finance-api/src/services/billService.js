const dayjs = require('dayjs');
const { sendWhatsAppMessage } = require('./waClient');

// Dua jadwal tagihan rutin utama sesuai preferensi pengguna:
// 1. Tanggal 27: WiFi (Internet Rumah)
// 2. Tanggal 2: Air & Listrik (PDAM & PLN)
// Tanpa nominal kaku, murni sistem pengingat jatuh tempo
const BILL_SCHEDULES = [
  {
    key: 'wifi_27',
    name: 'WiFi (Internet Rumah)',
    dueDay: 27,
    category: 'Listrik, Air & Wifi',
    icon: '📶',
    note: 'Jatuh tempo akhir bulan agar koneksi internet tetap lancar',
    exampleCmd: 'wifi 350rb',
  },
  {
    key: 'utility_2',
    name: 'Air & Listrik (PDAM & PLN)',
    dueDay: 2,
    category: 'Listrik, Air & Wifi',
    icon: '💡🚰',
    note: 'Jatuh tempo awal bulan untuk token/listrik & iuran air',
    exampleCmd: 'listrik 200rb, air 100rb',
  },
];

async function sendWifiReminder(userNumber, isManual = false) {
  const manualBadge = isManual ? '🧪 *(Simulasi Pengingat)*\n\n' : '';
  const message =
    `🔔 *PENGINGAT TAGIHAN RUTIN (TANGGAL 27)*\n\n` +
    manualBadge +
    `Halo Bro! Hari ini tanggal 27, jadwal pembayaran tagihan *WiFi (Internet Rumah)*. 📶\n\n` +
    `Segera selesaikan pembayaran sebelum jatuh tempo agar koneksi tetap aktif dan tidak terisolir ya!\n\n` +
    `💡 _Setelah membayar, Anda cukup mencatat pengeluarannya seperti biasa, contoh:_ \`wifi 350rb\``;

  return await sendWhatsAppMessage(userNumber, message);
}

async function sendUtilityReminder(userNumber, isManual = false) {
  const manualBadge = isManual ? '🧪 *(Simulasi Pengingat)*\n\n' : '';
  const message =
    `🔔 *PENGINGAT TAGIHAN RUTIN (TANGGAL 2)*\n\n` +
    manualBadge +
    `Halo Bro! Hari ini tanggal 2 awal bulan, jadwal pembayaran tagihan *Air & Listrik (PDAM & PLN)*. 💡🚰\n\n` +
    `Pastikan token listrik dan tagihan air bulanan sudah beres agar operasional rumah tetap nyaman!\n\n` +
    `💡 _Setelah membayar, Anda cukup mencatat pengeluarannya seperti biasa, contoh:_ \`listrik 200rb, air 100rb\``;

  return await sendWhatsAppMessage(userNumber, message);
}

async function generateBillReport(userNumber) {
  const now = dayjs();
  const todayDate = now.date();

  const lines = BILL_SCHEDULES.map((b, idx) => {
    let statusText = '';
    if (b.dueDay === todayDate) {
      statusText = ' ➔ 🚨 *HARI INI JATUH TEMPO!*';
    } else if (todayDate < b.dueDay) {
      const diff = b.dueDay - todayDate;
      statusText = ` _(sisa ${diff} hari lagi)_`;
    } else {
      const nextMonthDay = now.add(1, 'month').date(b.dueDay);
      const diff = nextMonthDay.diff(now, 'day');
      statusText = ` _(sisa ${diff} hari lagi)_`;
    }

    return (
      `${idx + 1}. ${b.icon} *${b.name}*${statusText}\n` +
      `   └ 🗓️ *Jadwal Pengingat:* Setiap Tanggal ${b.dueDay}\n` +
      `   └ 🏷️ *Kantong Anggaran:* ${b.category}\n` +
      `   └ 📝 *Catatan:* ${b.note}\n` +
      `   └ 💡 *Contoh Catat:* \`${b.exampleCmd}\``
    );
  });

  return (
    `📋 *JADWAL PENGINGAT TAGIHAN RUTIN*\n\n` +
    lines.join('\n\n') +
    `\n\n═══════════════════════\n` +
    `🤖 *Sistem Pengingat Otomatis:*\n` +
    `• Bot otomatis mengirimkan pengingat jam 09:00 pagi pada *Tanggal 27* (WiFi) dan *Tanggal 2* (Air & Listrik).\n` +
    `• Nominal tidak dikunci/ditentukan agar fleksibel sesuai tagihan riil bulanan Anda.\n\n` +
    `🧪 *Tes Notifikasi Pengingat Kapan Saja:*\n` +
    `• \`simulasi tagihan 27\` (tes pengingat WiFi)\n` +
    `• \`simulasi tagihan 2\` (tes pengingat Air & Listrik)`
  );
}

module.exports = {
  BILL_SCHEDULES,
  sendWifiReminder,
  sendUtilityReminder,
  generateBillReport,
};
