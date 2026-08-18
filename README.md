# KasirKu — POS Warung PWA

Aplikasi kasir warung dengan **struk cetak thermal Bluetooth (ESC/POS)**, pembayaran **tunai + QRIS statis**, dan **laporan tutup toko otomatis via WhatsApp** (`wa.me`).

- **Kasir**: Mobile PWA di **Android + Chrome** (Web Bluetooth wajib — tidak jalan di iOS).
- **Pemilik**: Dashboard desktop untuk produk, kasir, laporan, dan grafik 7 hari.

Stack: **FastAPI + MongoDB + React (CRA) + Tailwind + shadcn/ui**. Object storage via Emergent.

---

## Ringkasan Fitur MVP
- Auth JWT multi-kasir (owner + banyak akun cashier)
- CRUD produk (harga jual, HPP, stok, satuan pcs/kg/ons/botol/bungkus, ambang stok menipis)
- Layar kasir mobile-first: search, kategori, keranjang, modal qty desimal, bayar Tunai (kembalian otomatis) atau QRIS
- Cetak struk thermal **58mm** via Web Bluetooth (ESC/POS byte encoder)
- Cetak ulang dari riwayat
- Dashboard: kartu ringkasan, grafik 7 hari (Recharts), stok menipis
- Tutup toko → generate ringkasan → kirim ke WA pemilik via `wa.me`
- Onboarding wizard 4 langkah
- Upload QRIS via object storage (Emergent) atau bisa diganti storage lain

---

## Deployment ke VPS Ubuntu dengan Docker

### 0. Prasyarat VPS
- Ubuntu 22.04 LTS (atau 20.04) — 1 vCPU, 2 GB RAM, 20 GB disk minimum
- Domain (opsional tapi disarankan untuk HTTPS) yang sudah menunjuk A record ke IP VPS
- Port terbuka: **80**, **443** (HTTPS via reverse proxy nanti)

### 1. Install Docker + Docker Compose
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg git ufw

# Docker Engine + Compose plugin (resmi)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker

docker --version
docker compose version
```

### 2. Clone Repo dan Konfigurasi
```bash
mkdir -p /opt && cd /opt
git clone <URL_REPO_KAMU> kasirku
cd kasirku

cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Edit `backend/.env` dan `frontend/.env` sesuai bagian [Environment Variables](#environment-variables) di bawah.

### 3. Jalankan
```bash
docker compose up -d --build
docker compose ps
docker compose logs -f backend
```

Aplikasi akan tersedia di:
- `http://<IP-VPS>` (frontend + reverse proxy ke backend)

Login pertama pakai `ADMIN_EMAIL` / `ADMIN_PASSWORD` yang kamu set di `backend/.env` (default seed owner otomatis dibuat saat startup).

### 4. HTTPS (Sangat Disarankan — WAJIB untuk Web Bluetooth)

> **Web Bluetooth API HANYA jalan di halaman HTTPS** (kecuali `http://localhost`). Kalau kamu buka aplikasi via IP HTTP di HP kasir, tombol pairing printer **tidak akan bisa dipakai**. Wajib pakai domain + SSL.

Pakai **Caddy** (paling mudah, auto-SSL Let's Encrypt):

```bash
# Di host VPS, install Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
kasirku.example.com {
  reverse_proxy localhost:8080
}
EOF

sudo systemctl restart caddy
```

Ganti `kasirku.example.com` dengan domain milikmu. Caddy otomatis mengurus sertifikat Let's Encrypt.

Setelah itu edit `frontend/.env`:
```
REACT_APP_BACKEND_URL=https://kasirku.example.com
```
Lalu:
```bash
docker compose up -d --build frontend
```

### 5. Firewall
```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### 6. Update Aplikasi
```bash
cd /opt/kasirku
git pull
docker compose up -d --build
```

### 7. Backup MongoDB
```bash
docker exec kasirku-mongo mongodump --archive --db kasirku > backup-$(date +%F).archive
```

Restore:
```bash
cat backup-2026-02-18.archive | docker exec -i kasirku-mongo mongorestore --archive --drop
```

---

## Environment Variables

### `backend/.env`
| Variable | Wajib | Contoh | Keterangan |
|---|---|---|---|
| `MONGO_URL` | ✅ | `mongodb://mongo:27017` | URL Mongo. Di docker-compose default sudah pakai service name `mongo`. |
| `DB_NAME` | ✅ | `kasirku` | Nama database Mongo. |
| `JWT_SECRET` | ✅ | random 64 hex | **JANGAN pakai default.** Generate: `openssl rand -hex 32` |
| `ADMIN_EMAIL` | ✅ | `pemilik@warung.com` | Email owner default yang di-seed saat startup pertama. |
| `ADMIN_PASSWORD` | ✅ | `gantiSaya123` | Password owner. Ubah setelah login pertama. |
| `APP_NAME` | ✅ | `kasirku` | Prefix path object storage. |
| `EMERGENT_LLM_KEY` | ✅* | `sk-emergent-xxx` | Kunci Emergent Object Storage. *Wajib kalau pakai fitur upload QRIS/foto produk. |
| `INTEGRATION_PROXY_URL` | ⬜ | `https://integrations.emergentagent.com` | Default sudah benar, jangan diubah kecuali self-host. |
| `CORS_ORIGINS` | ⬜ | `https://kasirku.example.com` | Origin frontend. Boleh `*` untuk dev, harus explicit domain di production. |

### `frontend/.env`
| Variable | Wajib | Contoh | Keterangan |
|---|---|---|---|
| `REACT_APP_BACKEND_URL` | ✅ | `https://kasirku.example.com` | URL public backend. Semua request `/api/*` diarahkan ke sini oleh nginx reverse proxy. |

### Tanpa Emergent Object Storage (Alternatif)
Kalau tidak mau pakai Emergent Object Storage, kamu bisa:
1. Ganti kode `put_object` / `get_object` di `backend/server.py` menjadi tulis ke folder lokal `/app/data/uploads/`
2. Mount volume di `docker-compose.yml`: `- ./data:/app/data`
3. Kosongkan `EMERGENT_LLM_KEY`

---

## Perangkat yang Dibutuhkan
- **HP kasir**: Android 6+ dengan Chrome (Web Bluetooth API)
- **Printer thermal Bluetooth 58mm ESC/POS**: contoh Xprinter XP-P200, Eppos EP58, RPP02N (Rp 300–600 rb di marketplace)
- **Kertas thermal 58mm** (jangan sampai kehabisan — kalau habis, tombol "Cetak Ulang" tersedia di Riwayat)

---

## Alur Pakai Singkat
1. **Pemilik**: login → onboarding (info toko → upload QRIS → pairing printer → produk pertama) → dashboard
2. **Pemilik**: tambah akun kasir di menu Kasir
3. **Kasir**: login dari HP Android + Chrome → install PWA (Menu → Add to Home screen)
4. **Kasir**: pairing printer sekali di Pengaturan → transaksi → Bayar → Cetak Struk
5. **Akhir hari**: pemilik buka Dashboard → tap **Tutup Toko & Kirim ke WA** → laporan otomatis dikirim ke WA-nya

---

## Development Lokal (tanpa Docker)
Kalau mau kontribusi/debug:
```bash
# Backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8001 --reload

# Frontend
cd frontend
yarn install
yarn start
```
Butuh MongoDB lokal (`sudo apt install mongodb-org` atau `docker run -d -p 27017:27017 mongo:7`).

---

## Troubleshooting

**Printer tidak bisa dipair**
- Pastikan buka aplikasi via HTTPS (bukan IP HTTP)
- Pastikan pakai Chrome di Android (bukan Safari/Firefox/iOS)
- Nyalakan Bluetooth HP; printer sudah menyala

**QRIS tidak muncul**
- Cek `EMERGENT_LLM_KEY` sudah di-set di `backend/.env`
- Cek log: `docker compose logs backend | grep -i storage`

**Login gagal terus**
- Cek `JWT_SECRET` konsisten (jangan berubah tiap restart)
- Cek CORS: `CORS_ORIGINS` harus match domain frontend

**Sales tidak masuk / stok tidak update**
- Cek transaksi tersimpan: `docker exec -it kasirku-mongo mongosh kasirku --eval "db.transactions.find().pretty()"`

**Mongo penuh / slow**
- Backup + `db.transactions.deleteMany({created_at: {$lt: "2025-01-01"}})` untuk transaksi lama

---

## Lisensi
Internal / private. Sesuaikan dengan kebutuhanmu.
