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

// Cache untuk E2EE Retry Decryption (Mencegah "Waiting for this message")
const messageStore = new Map();
const retryMap = new Map();
const msgRetryCounterCache = {
  get: (k) => retryMap.get(k),
  set: (k, v) => {
    retryMap.set(k, v);
    if (retryMap.size > 2000) {
      const oldestKey = retryMap.keys().next().value;
      retryMap.delete(oldestKey);
    }
  },
  del: (k) => retryMap.delete(k),
};

const AUTH_DIR = process.env.AUTH_DIR || path.join(__dirname, '../auth_info');
const MEDIA_DIR = process.env.MEDIA_DIR || path.join(__dirname, '../media');
const FINANCE_API_URL = process.env.FINANCE_API_URL || 'http://finance-api:3000';

if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

// Tarik teks dari isi pesan apa pun (termasuk pesan yang kita kirim sendiri).
// Dipakai untuk membaca pesan yang sedang dibalas (quote/reply).
function extractMessageText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content.trim();

  if (content.conversation) return String(content.conversation).trim();
  if (content.extendedTextMessage?.text) return String(content.extendedTextMessage.text).trim();
  if (content.imageMessage?.caption) return String(content.imageMessage.caption).trim();
  if (content.documentMessage?.caption) return String(content.documentMessage.caption).trim();
  // Pesan berlapis (sekali lihat / sementara / dokumen berketerangan)
  if (content.viewOnceMessage?.message) return extractMessageText(content.viewOnceMessage.message);
  if (content.viewOnceMessageV2?.message) return extractMessageText(content.viewOnceMessageV2.message);
  if (content.ephemeralMessage?.message) return extractMessageText(content.ephemeralMessage.message);
  if (content.documentWithCaptionMessage?.message) {
    return extractMessageText(content.documentWithCaptionMessage.message);
  }
  return '';
}

// Normalisasi nomor: 08xxx -> 62xxx supaya format .env tidak harus seragam.
function normalizeNumber(value) {
  const clean = String(value || '').replace(/[^0-9]/g, '');
  return clean.startsWith('08') ? '62' + clean.slice(1) : clean;
}

function getAllowedNumbers() {
  const raw = String(process.env.ALLOWED_NUMBERS || '');
  return raw
    .split(',')
    .map((n) => normalizeNumber(n))
    .filter(Boolean);
}

function getLidAliases() {
  const raw = String(process.env.LID_ALIASES || '');
  return raw
    .split(',')
    .map((n) => n.replace(/[^0-9]/g, ''))
    .filter(Boolean);
}

function isSenderAllowed(senderJid) {
  if (!senderJid) return false;

  // 1. Tolak SEMUA pesan dari grup WhatsApp (@g.us)
  if (senderJid.endsWith('@g.us') || senderJid.includes('@g.us')) {
    return false;
  }

  // 2. Hanya izinkan chat pribadi (@s.whatsapp.net atau @lid)
  if (!senderJid.endsWith('@s.whatsapp.net') && !senderJid.endsWith('@lid')) {
    return false;
  }

  const raw = String(process.env.ALLOWED_NUMBERS || '');
  // Wildcard dicek dari string mentah (normalizeNumber membuang karakter '*').
  if (raw.split(',').some((item) => item.trim() === '*')) return true;

  const allowed = getAllowedNumbers();
  if (allowed.length === 0) return false;

  const cleanSender = senderJid.split('@')[0].replace(/[^0-9]/g, '');
  if (allowed.includes(normalizeNumber(cleanSender))) return true;

  // Pengirim berupa LID tidak bisa dicocokkan ke nomor HP: izinkan kalau terdaftar.
  return getLidAliases().includes(cleanSender);
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
    msgRetryCounterCache,
    getMessage: async (key) => {
      if (key?.id && messageStore.has(key.id)) {
        return messageStore.get(key.id);
      }
      return undefined;
    },
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
      // Lewati siaran broadcast dan SEMUA grup WhatsApp
      if (!sender || sender.includes('@broadcast') || sender.endsWith('@g.us') || sender.includes('@g.us')) {
        continue;
      }

      if (!isSenderAllowed(sender)) {
        console.log(`Pesan ditolak dari nomor/LID tidak terdaftar: ${sender}`);
        continue;
      }

      const messageContent = msg.message;
      if (!messageContent) continue;

      // Simpan payload pesan untuk handling E2EE retry
      if (msg.key?.id) {
        messageStore.set(msg.key.id, messageContent);
        if (messageStore.size > 2000) {
          const oldestKey = messageStore.keys().next().value;
          messageStore.delete(oldestKey);
        }
      }

      try {
        let text = '';
        let hasImage = false;
        let imageFilePath = null;
        let quoted = null;

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

        // Deteksi pesan yang sedang dibalas (quote/reply).
        // Berguna untuk meralat transaksi tertentu: user cukup balas pesan konfirmasi bot.
        const contextInfo =
          messageContent.extendedTextMessage?.contextInfo ||
          messageContent.imageMessage?.contextInfo ||
          messageContent.videoMessage?.contextInfo ||
          null;

        if (contextInfo?.stanzaId) {
          // Isi pesan yang dikutip biasanya sudah disertakan; kalau tidak, ambil dari
          // cache pesan yang sudah kita simpan (termasuk pesan yang kita kirim sendiri).
          const quotedText =
            extractMessageText(contextInfo.quotedMessage) ||
            extractMessageText(messageStore.get(contextInfo.stanzaId)) ||
            '';

          quoted = {
            id: contextInfo.stanzaId,
            participant: contextInfo.participant || null,
            text: quotedText,
          };
        }

        console.log(`Menerima pesan dari ${sender}: "${text}" (Gambar: ${hasImage})`);
        if (quoted) {
          console.log(`   ↳ Membalas pesan ${quoted.id}${quoted.text ? `: "${quoted.text.slice(0, 80)}"` : ' (isi tidak terbaca)'}`);
        }

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
            messageId: msg.key.id || null,
            quoted,
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
  const result = await sock.sendMessage(jid, { text });
  if (result?.key?.id && result?.message) {
    messageStore.set(result.key.id, result.message);
    if (messageStore.size > 2000) {
      const oldestKey = messageStore.keys().next().value;
      messageStore.delete(oldestKey);
    }
  }
  return result;
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
  const result = await sock.sendMessage(jid, {
    document: fileBuffer,
    fileName: fileName || path.basename(filePath),
    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    caption,
  });
  if (result?.key?.id && result?.message) {
    messageStore.set(result.key.id, result.message);
    if (messageStore.size > 2000) {
      const oldestKey = messageStore.keys().next().value;
      messageStore.delete(oldestKey);
    }
  }
  return result;
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
