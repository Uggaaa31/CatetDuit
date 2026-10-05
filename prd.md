🧾 Blueprint Sistem Pencatatan Keuangan Self-Hosted (WhatsApp, OCR, Email, Cloudflare Tunnel)
Berikut adalah rancangan lengkap sistem pencatatan pengeluaran & pemasukan yang berjalan di server lokal, diekspos melalui Cloudflare Tunnel, terintegrasi WhatsApp, punya OCR untuk foto struk belanja, dan membaca email notifikasi penarikan/pembayaran QRIS. Seluruh komponen berjalan di atas Docker Compose.

🧱 Arsitektur Umum
[User WhatsApp] ──► [Cloudflare Edge] ──► cloudflared-tunnel (Docker) ──► Traefik/Nginx (opsional)
                                                                          │
                          ┌───────────────────────────────────────────────┤
                          ▼                                               ▼
                whatsapp-gateway (Baileys)                     finance-api (FastAPI/Express)
                          │                                               │
                          │                                     ┌─────────┼─────────┐
                          │                                     ▼         ▼         ▼
                          │                              ocr-service   email-watcher   PostgreSQL
                          │                              (Tesseract/    (IMAP + Regex/
                          │                               LLM)           QRIS parser)
                          └─────────────────────────────────────────────────────────────┘
Semua komponen berada dalam satu network Docker dan hanya cloudflared yang berbicara ke luar.

1. WhatsApp Gateway (Baileys + REST API)
Beberapa proyek open-source siap pakai yang bisa langsung di-clone dan dijalankan dalam Docker:

paundrayudhad/whatsapp-gateway2 – Blazing-fast, self-hosted, Express.js + Prisma + Docker. Tanpa registrasi, cukup scan QR, dapat API key, langsung bisa kirim/terima pesan.3
Skael-GmbH/whatsapp-api-public – Multi-user, dashboard manajemen, MCP server, built on Baileys.4
jgalea/pigeon – REST API + MCP server + webhooks, berjalan di Docker.5
Cara kerja di sistem kita:

Buat service whatsapp-gateway dari salah satu proyek di atas.
Setelah bot terhubung ke akun WhatsApp, daftarkan webhook yang mengarah ke finance-api untuk setiap pesan masuk.
finance-api akan memproses perintah teks (misal: "makan siang 50rb") atau meneruskan gambar struk ke OCR service.
Ketika OCR atau email-watcher mendeteksi transaksi baru, finance-api memanggil API WhatsApp Gateway untuk mengirim notifikasi balik ke user.
2. OCR untuk Foto Struk Belanja
Dua pendekatan, tergantung kompleksitas yang diinginkan:

Pendekatan	Contoh Open-Source	Kelebihan
Tesseract + ML	KarasiewiczStephane/document-oc — preprocessing, Tesseract, LayoutLM transformer8	Ringan, self-contained, tanpa API eksternal
LLM Vision (Claude/GPT)	LevMuchnik/Receiptory — LLM-powered extraction, web upload, single Docker container9	Akurat, bisa tangkap item per item, harga, total, tanggal
Rekomendasi: Bangun ocr-service sederhana dengan Python FastAPI + pytesseract (plus OpenAI/Claude Vision sebagai fallback). Endpoint menerima image_url dari WhatsApp Gateway → mengembalikan JSON { total, date, items[], category }.

3. Pemantauan Email untuk Penarikan & Pembayaran QRIS
Gunakan library IMAP client (Python imaplib atau Go go-imap) untuk membaca email dari penyedia e-wallet/bank. Beberapa referensi:

baijum/kanakku — Bank Transaction Email Parser, terstruktur untuk memproses email transaksi bank.16
saquone/qris (Go) — Self-hosted library untuk membaca QR dari gambar, mengekstrak nominal dari notifikasi bank/e-wallet (DANA Bisnis, BRI, GoPay, Grab, dll), mengirim webhook bertanda tangan.20
Desain `email-watcher` service:

Login IMAP ke akun email yang terdaftar di notifikasi bank/e-wallet.
Cari email dengan subjek tertentu (misal: "Pembayaran QRIS Berhasil", "Penarikan Saldo").
Ekstrak jumlah, merchant, tanggal, tipe transaksi menggunakan regex.
Kirim data ke finance-api (POST /transactions).
finance-api menyimpan ke PostgreSQL dan meneruskan notifikasi ke user via WhatsApp.
4. Cloudflare Tunnel untuk Expose ke Publik
Agar dashboard/webhook API bisa diakses dari luar tanpa port forwarding:

Gunakan container resmi cloudflare/cloudflared dalam Docker Compose.1214
Tunnel membuat outbound-only connection ke Cloudflare edge, sangat aman tanpa perlu buka port inbound.11
Konfigurasi tunnel didefinisikan di file config.yml yang di-mount ke container.
Contoh potongan `docker-compose.yml`:

services:
  cloudflared:
    image: cloudflare/cloudflared:latest
    command: tunnel run
    environment:
      - TUNNEL_TOKEN=${CF_TUNNEL_TOKEN}
    restart: unless-stopped
Setelah tunnel aktif, dashboard web finance-api bisa diakses melalui https://keuangan.domain-anda.com dengan perlindungan Cloudflare Access.

5. Database & Finance API (Backend Utama)
Bisa menggunakan PostgreSQL + Prisma ORM (seperti yang dipakai di whatsapp-gateway23 dan Receiptory9).

Skema minimal:

transactions (
  id UUID,
  type ENUM('income','expense'),
  source ENUM('manual','ocr','email_qris'),
  amount DECIMAL,
  description TEXT,
  category VARCHAR,
  merchant_name VARCHAR,
  receipt_image_url VARCHAR,
  notification_email_raw TEXT,
  created_at TIMESTAMP
)
finance-api (FastAPI atau Express) bertindak sebagai orchestrator:

Menerima perintah dari WhatsApp (POST /bot/webhook)
Memanggil OCR service (POST /ocr/extract)
Menerima data dari email watcher (POST /transactions)
Menyediakan dashboard web sederhana (GET /dashboard)
Memanggil WhatsApp API untuk mengirim notifikasi balik
🚀 Langkah Implementasi
Siapkan VPS/PC lokal dengan Docker & Docker Compose terinstal.
Clone & setup WhatsApp Gateway (pilih salah satu 345), pastikan bisa scan QR dan kirim pesan.
Buat service `ocr-service` sederhana (Python FastAPI) yang memanggil Tesseract + optional LLM Vision.
Buat service `email-watcher` (Python script yang berjalan sebagai cron/daemon, membaca IMAP setiap 5 menit).
Buat `finance-api` (FastAPI) yang menyatukan semua logic, termasuk menyimpan ke PostgreSQL.
Setup Cloudflare Tunnel dengan token dari dashboard Cloudflare Zero Trust.
Hubungkan webhook WhatsApp Gateway agar setiap pesan masuk diteruskan ke finance-api.
Tes end-to-end: kirim foto struk lewat WA → OCR baca → simpan transaksi → notifikasi balik ke WA. Tes email masuk → otomatis catat transaksi QRIS.