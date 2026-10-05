const express = require('express');
const cors = require('cors');
const {
  connectToWhatsApp,
  requestPairing,
  sendTextMessage,
  sendDocumentMessage,
  getStatus,
  getQR,
} = require('./whatsapp');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// API Endpoints
app.get('/api/status', (req, res) => {
  res.json(getStatus());
});

app.get('/api/qr', (req, res) => {
  res.json(getQR());
});

app.post('/api/pair', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ error: 'Nomor telepon wajib diisi.' });
    }
    const code = await requestPairing(phoneNumber);
    res.json({ success: true, code });
  } catch (err) {
    console.error('Error request pairing code:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/send-message', async (req, res) => {
  try {
    const { to, text } = req.body;
    if (!to || !text) {
      return res.status(400).json({ error: 'Parameter "to" dan "text" wajib diisi.' });
    }
    const result = await sendTextMessage(to, text);
    res.json({ success: true, result });
  } catch (err) {
    console.error('Error send-message:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/send-document', async (req, res) => {
  try {
    const { to, filePath, fileName, caption } = req.body;
    if (!to || !filePath) {
      return res.status(400).json({ error: 'Parameter "to" dan "filePath" wajib diisi.' });
    }
    const result = await sendDocumentMessage(to, filePath, fileName, caption);
    res.json({ success: true, result });
  } catch (err) {
    console.error('Error send-document:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// UI Webpage for QR Code & Pairing Code
app.get(['/', '/qr'], (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hubungkan WhatsApp - Catat Duit</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    body { background: #0b141a; color: #e9edef; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: #111b21; border: 1px solid #202c33; border-radius: 16px; padding: 32px; max-width: 480px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.5); text-align: center; }
    h1 { font-size: 22px; color: #00a884; margin-bottom: 8px; }
    p.desc { font-size: 14px; color: #8696a0; margin-bottom: 24px; }
    
    .tabs { display: flex; gap: 8px; margin-bottom: 24px; background: #202c33; padding: 4px; border-radius: 10px; }
    .tab-btn { flex: 1; padding: 10px; border: none; background: transparent; color: #8696a0; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 14px; transition: 0.2s; }
    .tab-btn.active { background: #00a884; color: #fff; }
    
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    
    .qr-container { background: #fff; padding: 16px; border-radius: 12px; display: inline-block; margin-bottom: 16px; min-width: 250px; min-height: 250px; display: flex; align-items: center; justify-content: center; }
    .qr-container img { width: 240px; height: 240px; display: block; }
    
    .badge-status { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 20px; font-size: 13px; font-weight: 600; margin-bottom: 20px; }
    .badge-connected { background: rgba(34, 197, 94, 0.15); color: #22c55e; border: 1px solid #22c55e; }
    .badge-waiting { background: rgba(234, 179, 8, 0.15); color: #eab308; border: 1px solid #eab308; }
    
    .input-group { margin-bottom: 16px; text-align: left; }
    label { display: block; font-size: 13px; color: #8696a0; margin-bottom: 6px; }
    input[type="text"] { width: 100%; padding: 12px 16px; background: #202c33; border: 1px solid #2a3942; border-radius: 8px; color: #fff; font-size: 15px; outline: none; }
    input[type="text"]:focus { border-color: #00a884; }
    
    .btn { width: 100%; padding: 12px; background: #00a884; color: #fff; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; transition: 0.2s; }
    .btn:hover { background: #02906f; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    
    .code-display { font-size: 28px; letter-spacing: 6px; font-weight: 700; color: #00a884; background: #202c33; padding: 16px; border-radius: 10px; margin: 16px 0; border: 1px dashed #00a884; }
    .step-box { text-align: left; font-size: 13px; color: #8696a0; line-height: 1.6; background: #182229; padding: 16px; border-radius: 8px; margin-top: 16px; }
  </style>
</head>
<body>

  <div class="card">
    <h1>🤖 Catat Duit WhatsApp</h1>
    <p class="desc">Hubungkan akun WhatsApp Bot Anda</p>
    
    <div id="statusBadge" class="badge-status badge-waiting">
      <span>●</span> <span id="statusText">Menunggu Sambungan...</span>
    </div>

    <!-- Tampilan Jika Sudah Terhubung -->
    <div id="connectedView" style="display: none;">
      <div style="font-size: 50px; margin-bottom: 16px;">🎉</div>
      <h2 style="color: #22c55e; margin-bottom: 8px;">WhatsApp Berhasil Terhubung!</h2>
      <p style="color: #8696a0; font-size: 14px; margin-bottom: 16px;">Bot aktif dan siap menerima perintah pencatatan pengeluaran.</p>
      <div style="background: #202c33; padding: 12px; border-radius: 8px; font-family: monospace; font-size: 14px;">
        Akun: <span id="connectedAccount" style="color: #00a884;">-</span>
      </div>
    </div>

    <!-- Tampilan Form Sambungan -->
    <div id="connectView">
      <div class="tabs">
        <button class="tab-btn active" onclick="switchTab('qrTab')">📷 Scan QR Code</button>
        <button class="tab-btn" onclick="switchTab('pairTab')">🔢 Kode Pairing (8 Digit)</button>
      </div>

      <!-- TAB 1: QR CODE -->
      <div id="qrTab" class="tab-content active">
        <div class="qr-container">
          <img id="qrImg" src="" alt="Menyiapkan QR Code..." style="display: none;" />
          <div id="qrPlaceholder" style="color: #555; font-size: 13px;">Memuat QR Code...</div>
        </div>
        <div class="step-box">
          <b>Cara Scan:</b><br>
          1. Buka WhatsApp di HP Anda.<br>
          2. Ketuk <b>Menu (⋮)</b> atau <b>Pengaturan</b> &gt; <b>Perangkat Tertaut</b>.<br>
          3. Ketuk <b>Tautkan Perangkat</b> dan arahkan kamera ke QR di atas.
        </div>
      </div>

      <!-- TAB 2: PAIRING CODE -->
      <div id="pairTab" class="tab-content">
        <div class="input-group">
          <label for="phoneNumber">Nomor WhatsApp Bot (format: 628xxxxxxxx):</label>
          <input type="text" id="phoneNumber" placeholder="Contoh: 628123456789" />
        </div>
        <button id="btnPair" class="btn" onclick="getPairingCode()">Minta Kode Pairing</button>

        <div id="codeResult" style="display: none;">
          <div class="code-display" id="pairingCodeDisplay">----</div>
          <div class="step-box">
            <b>Langkah Memasukkan Kode di WhatsApp:</b><br>
            1. Buka WhatsApp di HP Anda.<br>
            2. Ketuk <b>Perangkat Tertaut</b> &gt; <b>Tautkan Perangkat</b>.<br>
            3. Ketuk tulisan <b>"Tautkan dengan nomor telepon saja"</b> di bawah layar.<br>
            4. Masukkan kode 8 digit di atas.
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    function switchTab(tabId) {
      document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      
      if (tabId === 'qrTab') {
        document.querySelectorAll('.tab-btn')[0].classList.add('active');
        document.getElementById('qrTab').classList.add('active');
      } else {
        document.querySelectorAll('.tab-btn')[1].classList.add('active');
        document.getElementById('pairTab').classList.add('active');
      }
    }

    async function checkStatus() {
      try {
        const res = await fetch('/api/qr');
        const data = await res.json();

        if (data.isConnected) {
          document.getElementById('statusBadge').className = 'badge-status badge-connected';
          document.getElementById('statusText').innerText = 'Terhubung';
          document.getElementById('connectView').style.display = 'none';
          document.getElementById('connectedView').style.display = 'block';
          return;
        }

        if (data.qrImage) {
          const img = document.getElementById('qrImg');
          img.src = data.qrImage;
          img.style.display = 'block';
          document.getElementById('qrPlaceholder').style.display = 'none';
        }
      } catch (err) {
        console.error('Error fetching QR:', err);
      }
    }

    async function getPairingCode() {
      const phoneInput = document.getElementById('phoneNumber');
      const btn = document.getElementById('btnPair');
      const val = phoneInput.value.trim().replace(/[^0-9]/g, '');

      if (!val || val.length < 9) {
        alert('Masukkan nomor WhatsApp yang valid (misal: 628xxxxxxxx)');
        return;
      }

      btn.disabled = true;
      btn.innerText = 'Mengambil Kode...';

      try {
        const res = await fetch('/api/pair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phoneNumber: val })
        });
        const json = await res.json();

        if (json.success && json.code) {
          document.getElementById('codeResult').style.display = 'block';
          document.getElementById('pairingCodeDisplay').innerText = json.code;
        } else {
          alert('Gagal mendapatkan kode: ' + (json.error || 'Coba lagi beberapa saat'));
        }
      } catch (err) {
        alert('Error: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerText = 'Minta Kode Pairing';
      }
    }

    // Polling live setiap 2 detik tanpa reload halaman
    setInterval(checkStatus, 2000);
    checkStatus();
  </script>
</body>
</html>
  `);
});

app.listen(PORT, () => {
  console.log(`WhatsApp Gateway berjalan di port ${PORT}`);
  connectToWhatsApp().catch((err) => {
    console.error('Inisialisasi WhatsApp gagal:', err);
  });
});
