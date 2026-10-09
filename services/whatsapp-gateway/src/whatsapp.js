const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  Browsers,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

let sock = null;
let currentQR = null;
let currentQRImage = null;
let isConnected = false;
let connectedUser = null;

const AUTH_DIR = process.env.AUTH_DIR || path.join(__dirname, '../auth_info');
const MEDIA_DIR = process.env.MEDIA_DIR || path.join(__dirname, '../media');
const FINANCE_API_URL = process.env.FINANCE_API_URL || 'http://finance-api:3000';

if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

function getAllowedNumbers() {
  const raw = process.env.ALLOWED_NUMBERS || '';
  return raw
    .split(',')
    .map((n) => n.trim().replace(/[^0-9]/g, ''))
    .filter(Boolean);
}

function isSenderAllowed(senderJid, msgKey) {
  const allowed = getAllowedNumbers();
  if (allowed.length === 0 || allowed.includes('*')) return true;

  const senderNumber = senderJid.split('@')[0];
  if (allowed.includes(senderNumber)) return true;

  if (msgKey?.participant) {
    const p = msgKey.participant.split('@')[0];
    if (allowed.includes(p)) return true;
  }

  // Jika chat pribadi (@lid atau @s.whatsapp.net), dan allowed mengandung nomor user/bot
  // secara otomatis izinkan pesan pribadi pengguna yang sedang berinteraksi
  if (senderJid.endsWith('@lid') || senderJid.endsWith('@s.whatsapp.net')) {
    // Jika senderNumber terdaftar di allowed
    if (allowed.includes(senderNumber)) return true;
  }

  return false;
}

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`Menggunakan versi Baileys WA: v${version.join('.')} (Latest: ${isLatest})`);

  sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    browser: Browsers.ubuntu('Chrome'),
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQR = qr;
      try {
        currentQRImage = await QRCode.toDataURL(qr, { margin: 2, scale: 7 });
      } catch (err) {
        console.error('Failed to generate QR Image:', err.message);
      }
      console.log('\n================ QR CODE WHATSAPP ================');
      qrcodeTerminal.generate(qr, { small: true });
      console.log('Silakan scan QR code di atas dengan aplikasi WhatsApp.');
      console.log('Atau buka browser: http://localhost:3001/qr');
      console.log('===================================================\n');
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      const isRestartRequired = statusCode === DisconnectReason.restartRequired;

      console.log(`Koneksi WhatsApp terputus. Status Code: ${statusCode}`);

      isConnected = false;
      connectedUser = null;

      if (isLoggedOut) {
        console.log('Sesi logout. Membersihkan file auth_info...');
        try {
          if (fs.existsSync(AUTH_DIR)) {
            const files = fs.readdirSync(AUTH_DIR);
            for (const file of files) {
              fs.unlinkSync(path.join(AUTH_DIR, file));
            }
          }
        } catch (cleanErr) {
          console.error('Gagal membersihkan auth_info:', cleanErr.message);
        }
        setTimeout(connectToWhatsApp, 2000);
      } else if (isRestartRequired) {
        console.log('WhatsApp memerlukan restart handshake (515). Menyambungkan segera...');
        setTimeout(connectToWhatsApp, 500);
      } else {
        console.log('Mencoba menyambungkan kembali dalam 3 detik...');
        setTimeout(connectToWhatsApp, 3000);
      }
    } else if (connection === 'open') {
      isConnected = true;
      currentQR = null;
      currentQRImage = null;
      connectedUser = sock.user;
      console.log('✅ WhatsApp Gateway Terhubung! Akun:', sock.user?.id);
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      const sender = msg.key.remoteJid;
      if (!sender || sender.includes('@broadcast')) continue;

      if (!isSenderAllowed(sender, msg.key)) {
        console.log(`Pesan ditolak dari nomor/LID tidak terdaftar: ${sender}`);
        continue;
      }

      const messageContent = msg.message;
      if (!messageContent) continue;

      try {
        let text = '';
        let hasImage = false;
        let imageFilePath = null;

        if (messageContent.conversation) {
          text = messageContent.conversation.trim();
        } else if (messageContent.extendedTextMessage?.text) {
          text = messageContent.extendedTextMessage.text.trim();
        } else if (messageContent.imageMessage) {
          hasImage = true;
          text = messageContent.imageMessage.caption ? messageContent.imageMessage.caption.trim() : '';

          try {
            const buffer = await downloadMediaMessage(
              msg,
              'buffer',
              {},
              {
                logger: pino({ level: 'silent' }),
                reuploadRequest: sock.updateMediaMessage,
              }
            );

            const filename = `receipt_${Date.now()}_${msg.key.id}.jpg`;
            imageFilePath = path.join(MEDIA_DIR, filename);
            fs.writeFileSync(imageFilePath, buffer);
            console.log(`Foto struk disimpan ke: ${imageFilePath}`);
          } catch (mediaErr) {
            console.error('Gagal mengunduh gambar struk:', mediaErr.message);
          }
        }

        if (!text && !hasImage) continue;

        console.log(`Menerima pesan dari ${sender}: "${text}" (Gambar: ${hasImage})`);

        // Forward to finance-api webhook
        await fetch(`${FINANCE_API_URL}/bot/webhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: sender,
            senderName: msg.pushName || 'Pengguna',
            text,
            hasImage,
            imageFilePath,
            timestamp: msg.messageTimestamp,
          }),
        }).catch((err) => {
          console.error('Gagal meneruskan pesan ke finance-api:', err.message);
        });
      } catch (err) {
        console.error('Error memproses pesan WhatsApp:', err);
      }
    }
  });
}

async function requestPairing(phoneNumber) {
  if (!sock) {
    throw new Error('WhatsApp Gateway belum diinisialisasi.');
  }
  const clean = phoneNumber.replace(/[^0-9]/g, '');
  if (!clean || clean.length < 9) {
    throw new Error('Nomor HP tidak valid. Masukkan dengan format 628xxxxxxxx');
  }
  console.log(`Meminta kode pairing untuk nomor: ${clean}`);
  const code = await sock.requestPairingCode(clean);
  console.log(`Kode pairing berhasil diperoleh: ${code}`);
  return code;
}

async function sendTextMessage(to, text) {
  if (!sock || !isConnected) {
    throw new Error('WhatsApp Gateway belum terhubung!');
  }
  let jid = to;
  if (!jid.includes('@')) {
    const clean = to.replace(/[^0-9]/g, '');
    jid = clean.length >= 14 && !clean.startsWith('62') ? `${clean}@lid` : `${clean}@s.whatsapp.net`;
  }
  console.log(`[whatsapp-gateway] Mengirim pesan ke: ${jid}`);
  return await sock.sendMessage(jid, { text });
}

async function sendDocumentMessage(to, filePath, fileName, caption = '') {
  if (!sock || !isConnected) {
    throw new Error('WhatsApp Gateway belum terhubung!');
  }
  let jid = to;
  if (!jid.includes('@')) {
    const clean = to.replace(/[^0-9]/g, '');
    jid = clean.length >= 14 && !clean.startsWith('62') ? `${clean}@lid` : `${clean}@s.whatsapp.net`;
  }
  const fileBuffer = fs.readFileSync(filePath);

  console.log(`[whatsapp-gateway] Mengirim dokumen ke: ${jid}`);
  return await sock.sendMessage(jid, {
    document: fileBuffer,
    fileName: fileName || path.basename(filePath),
    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    caption,
  });
}

function getStatus() {
  return {
    isConnected,
    user: connectedUser,
    hasQR: !!currentQR,
  };
}

function getQR() {
  return {
    qr: currentQR,
    qrImage: currentQRImage,
    isConnected,
  };
}

module.exports = {
  connectToWhatsApp,
  requestPairing,
  sendTextMessage,
  sendDocumentMessage,
  getStatus,
  getQR,
};
