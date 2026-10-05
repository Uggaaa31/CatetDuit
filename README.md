# 📱 Catat Duit WhatsApp (Headless Self-Hosted Finance Bot)

Sistem pencatatan keuangan pribadi dan bisnis otomatis berbasis **WhatsApp**, dengan **OCR Struk Belanja**, **Email Watcher untuk notifikasi QRIS & Bank**, serta **Database PostgreSQL**, berjalan penuh di atas **Docker Compose**.

Sistem ini **100% Conversational UI** (berjalan sepenuhnya di dalam chat WhatsApp) tanpa memerlukan web frontend.

---

## 🧱 Arsitektur Sistem (Docker Compose)

```
[ WhatsApp User ]
       │
       ▼ (WebSocket Baileys)
┌─────────────────────────────────────────────────────────────┐
│ catatduit_whatsapp_gateway (Port 3001)                      │
│ - Menghubungkan bot ke nomor WhatsApp via Baileys          │
│ - Forward pesan masuk ke finance-api                        │
│ - Menyediakan endpoint kirim pesan & dokumen Excel          │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP Webhook
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ catatduit_finance_api (Port 3000)                           │
│ - Orchestrator pencatatan keuangan & NLP Parser Bahasa Indo │
│ - Rekap harian / mingguan / bulanan & generator Excel (.xlsx)│
│ - Menghubungkan database & koordinasi notifikasi            │
└───────┬──────────────────────┬──────────────────────┬───────┘
        │                      │                      │
        ▼                      ▼                      ▼
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│  ocr-service │       │ email-watcher│       │   postgres   │
│  (Port 8000) │       │ (IMAP Watch) │       │ (Port 5432)  │
│  Gemini AI + │       │ Auto-detect  │       │ Database     │
│  Tesseract   │       │ QRIS & Bank  │       │ Keuangan     │
└──────────────┘       └──────────────┘       └──────────────┘
```

---

## 🚀 Cara Menjalankan

### 1. Konfigurasi `.env`
Buka file `.env` di direktori utama, sesuaikan nomor WhatsApp Anda:
```env
ALLOWED_NUMBERS=6281234567890
```
> **Catatan:** Gunakan kode negara `62` tanpa tanda `+` atau spasi. Anda bisa memasukkan lebih dari satu nomor dipisahkan tanda koma.

Jika ingin menggunakan **OCR AI untuk foto struk belanja**, isi:
```env
GEMINI_API_KEY=AIzaSy...
```
*(Bisa didapatkan gratis di [Google AI Studio](https://aistudio.google.com/)).*

Jika ingin fitur **baca email otomatis untuk QRIS / Bank**, isi bagian IMAP:
```env
IMAP_USER=emailanda@gmail.com
IMAP_PASSWORD=app_password_anda
```

---

### 2. Jalankan Docker Compose
Jalankan perintah berikut di terminal:
```bash
docker compose up -d --build
```

---

### 3. Hubungkan WhatsApp (Scan QR Code)
Anda memiliki 2 cara mudah untuk scan QR:
1. **Via Browser:** Buka `http://localhost:3001/qr` di browser Anda.
2. **Via Terminal:** Jalankan perintah:
   ```bash
   docker compose logs -f whatsapp-gateway
   ```
Buka aplikasi WhatsApp di HP Anda > **Perangkat Tertaut** > **Tautkan Perangkat**, lalu scan QR code yang tampil.

Setelah terhubung, bot akan langsung aktif! Sesi login Anda tersimpan di volume Docker sehingga **tidak perlu scan QR lagi saat container di-restart**.

---

## 💬 Panduan Perintah di WhatsApp

### 1. Mencatat Pengeluaran
Cukup ketik secara alami:
- `makan siang 35rb` *(otomatis kategori Makanan & Minuman)*
- `kopi 20k`
- `bensin 50000` *(otomatis kategori Transportasi)*
- `pulsa indosat 100rb` *(otomatis kategori Tagihan & Utilitas)*
- `beli sabun mandi 25rb`

### 2. Mencatat Pemasukan
Awali dengan tanda `+` atau kata `pemasukan`/`gaji`:
- `+gaji 6.5jt`
- `+bonus 500rb`
- `pemasukan freelance 750k`

### 3. Foto Struk Belanja (OCR)
- Kirim langsung **foto struk belanja** (Indomaret, Alfamart, restoran, dll.) ke chat bot.
- Bot akan otomatis membaca total belanja, nama toko, tanggal, dan mencatatnya ke pembukuan.

### 4. Melihat Rekap / Laporan
- `rekap` *(melihat rekap hari ini)*
- `rekap minggu ini`
- `rekap bulan ini`
- `rekap kemarin`

### 5. Membatalkan Catatan Terakhir (Undo)
- Ketik `batal` atau `hapus` jika ada salah input.

### 6. Ekspor Data ke Excel (.xlsx)
- Ketik `export excel` atau `ekspor`.
- Bot akan langsung membuat dan mengirim file dokumen Excel lengkap dengan rincian dan grafik formula saldo langsung ke chat WhatsApp Anda.

### 7. Bantuan
- Ketik `bantuan` atau `help` untuk menampilkan menu panduan.
