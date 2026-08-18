# KasirKu — POS Warung PWA

Aplikasi kasir warung dengan **struk cetak thermal Bluetooth (ESC/POS)**, pembayaran **tunai + QRIS statis**, dan **laporan tutup toko otomatis via WhatsApp** (`wa.me`).

- **Kasir**: Mobile PWA di **Android + Chrome** (Web Bluetooth wajib — tidak jalan di iOS).
- **Pemilik**: Dashboard desktop untuk produk, kasir, laporan, dan grafik 7 hari.

Stack: **FastAPI + PostgreSQL + React (CRA) + Tailwind + shadcn/ui**. Object storage via Emergent.

---

## Ringkasan Fitur MVP
- Auth JWT multi-kasir (owner + banyak akun cashier)
- CRUD produk (harga jual, HPP, stok, satuan pcs/kg/ons/botol/bungkus, ambang stok menipis)
- Layar kasir mobile-first: search, kategori, keranjang, modal qty desimal, bayar Tunai (kembalian otomatis) atau QRIS
- Cetak struk thermal **58mm** via Web Bluetooth (ESC/POS byte encoder)
- Cetak ulang dari riwayat + cetak label barcode CODE128 per produk
- Barcode scan pakai native `BarcodeDetector` (Chrome Android) dengan fallback manual
- Mode offline (Dexie IndexedDB) — transaksi antri lokal, auto-sync saat online
- Dashboard: kartu ringkasan, grafik 7 hari (Recharts), stok menipis
- Tutup toko → generate ringkasan → kirim ke WA pemilik via `wa.me`
- Onboarding wizard 4 langkah
- Upload QRIS via object storage (Emergent) atau bisa diganti storage lain

---

## Deployment ke VPS Ubuntu dengan Docker

> Untuk Windows lihat bagian [Install di Windows](#install-di-windows-desktop).

### 0. Prasyarat VPS
- Ubuntu 22.04 LTS (atau 20.04) — 1 vCPU, 2 GB RAM, 20 GB disk minimum
- Domain (opsional tapi disarankan untuk HTTPS) yang sudah menunjuk A record ke IP VPS
- Port terbuka: **80**, **443** (HTTPS via reverse proxy nanti)

### 1. Install Docker + Docker Compose
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg git ufw

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

Edit `backend/.env` dan `frontend/.env` sesuai bagian [Environment Variables](#environment-variables). **Jangan lupa** ganti `JWT_SECRET`, `ADMIN_PASSWORD`, dan `POSTGRES_PASSWORD` (di root `.env` untuk docker-compose).

Opsional — buat file `.env` di root project untuk override kredensial Postgres (dipakai oleh `docker-compose.yml`):
```bash
cat > .env <<'EOF'
POSTGRES_USER=kasirku
POSTGRES_PASSWORD=gantiPasswordIniYangKuat123
POSTGRES_DB=kasirku
PUBLIC_URL=https://kasirku.example.com
EOF
```

Lalu sesuaikan `DATABASE_URL` di `backend/.env`:
```
DATABASE_URL="postgresql+asyncpg://kasirku:gantiPasswordIniYangKuat123@postgres:5432/kasirku"
```

### 3. Jalankan
```bash
docker compose up -d --build
docker compose ps
docker compose logs -f backend
```

Aplikasi akan tersedia di:
- `http://<IP-VPS>:8080` (frontend + reverse proxy `/api` ke backend)

Login pertama pakai `ADMIN_EMAIL` / `ADMIN_PASSWORD` yang kamu set di `backend/.env` (owner default di-seed otomatis saat startup, dan tabel di-migrate otomatis via SQLAlchemy `create_all`).

### 4. HTTPS (Sangat Disarankan — WAJIB untuk Web Bluetooth)

> **Web Bluetooth API HANYA jalan di halaman HTTPS** (kecuali `http://localhost`). Kalau buka aplikasi via IP HTTP di HP kasir, tombol pairing printer **tidak akan bisa dipakai**. Wajib pakai domain + SSL.

Pakai **Caddy** (paling mudah, auto-SSL Let's Encrypt):

```bash
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

Ganti `kasirku.example.com` dengan domain milikmu.

Update `frontend/.env`:
```
REACT_APP_BACKEND_URL=https://kasirku.example.com
```
Rebuild frontend:
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

### 7. Backup PostgreSQL
```bash
# Backup harian (jadwalkan via cron)
docker exec kasirku-postgres pg_dump -U kasirku -d kasirku -Fc \
  > /opt/backups/kasirku-$(date +%F).dump

# Contoh cron entry: setiap hari jam 23:30
# 30 23 * * * docker exec kasirku-postgres pg_dump -U kasirku -d kasirku -Fc > /opt/backups/kasirku-$(date +\%F).dump
```

Restore:
```bash
docker exec -i kasirku-postgres pg_restore -U kasirku -d kasirku --clean --if-exists < /opt/backups/kasirku-2026-02-18.dump
```

---

## Environment Variables

### Root `.env` (opsional, hanya untuk `docker-compose`)
| Variable | Wajib | Contoh | Keterangan |
|---|---|---|---|
| `POSTGRES_USER` | ⬜ | `kasirku` | Default `kasirku`. |
| `POSTGRES_PASSWORD` | ✅ | `passwordKuat123` | **Ganti dari default!** |
| `POSTGRES_DB` | ⬜ | `kasirku` | Default `kasirku`. |
| `PUBLIC_URL` | ⬜ | `https://kasirku.example.com` | Dipakai sebagai build-arg `REACT_APP_BACKEND_URL` untuk frontend. |

### `backend/.env`
| Variable | Wajib | Contoh | Keterangan |
|---|---|---|---|
| `DATABASE_URL` | ✅ | `postgresql+asyncpg://kasirku:pass@postgres:5432/kasirku` | Koneksi Postgres via driver **asyncpg**. Wajib prefix `postgresql+asyncpg://`. |
| `JWT_SECRET` | ✅ | random 64 hex | Generate: `openssl rand -hex 32`. Konsisten antar restart. |
| `ADMIN_EMAIL` | ✅ | `pemilik@warung.com` | Owner default yang di-seed di startup pertama. |
| `ADMIN_PASSWORD` | ✅ | `gantiSaya123` | Ubah setelah login pertama. |
| `APP_NAME` | ✅ | `kasirku` | Prefix path object storage. |
| `EMERGENT_LLM_KEY` | ✅* | `sk-emergent-xxx` | Kunci Emergent Object Storage untuk upload QRIS/foto produk. |
| `INTEGRATION_PROXY_URL` | ⬜ | `https://integrations.emergentagent.com` | Default sudah benar. |
| `CORS_ORIGINS` | ⬜ | `https://kasirku.example.com` | Origin frontend production. `*` hanya untuk dev. |

### `frontend/.env`
| Variable | Wajib | Contoh | Keterangan |
|---|---|---|---|
| `REACT_APP_BACKEND_URL` | ✅ | `https://kasirku.example.com` | URL public backend. **Dipakai saat build**, jadi harus rebuild frontend kalau URL berubah. |

### Tanpa Emergent Object Storage (Alternatif)
Kalau tidak mau pakai Emergent Object Storage, kamu bisa:
1. Ganti `put_object` / `get_object` di `backend/server.py` menjadi write ke folder lokal `/app/data/uploads/`
2. Mount volume di `docker-compose.yml`: `- ./data:/app/data`
3. Kosongkan `EMERGENT_LLM_KEY`

---

## Migrasi Skema Database

Skema dikelola pakai **Alembic**. Saat backend startup pertama, `Base.metadata.create_all` masih dipakai sebagai safety net (idempotent), tapi untuk perubahan skema baru gunakan Alembic.

```bash
# Masuk container backend (atau di dev lokal, cd backend + venv aktif)
docker exec -it kasirku-backend bash

# Cek status
alembic current

# Autogenerate migration dari perubahan model
alembic revision --autogenerate -m "add column products.barcode"

# Terapkan migrasi
alembic upgrade head

# Rollback satu migrasi
alembic downgrade -1

# Stamp DB yang sudah ada tabelnya (bootstrap alembic tanpa apply)
alembic stamp head
```

File: `backend/alembic.ini`, `backend/migrations/env.py`, `backend/migrations/versions/`. Initial revision `0001_initial` sudah tercatat.

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

## Install di Windows (Desktop)

Cocok untuk **coba dulu di laptop toko**, uji cetak dari HP kasir sebelum sewa VPS.

### 0. Prasyarat
- Windows 10 (build 19041+) atau Windows 11
- Minimal 8 GB RAM (Docker Desktop butuh 4 GB idle)
- Koneksi internet untuk sekali download images

### 1. Install Tools
1. **Docker Desktop for Windows** — https://www.docker.com/products/docker-desktop
   - Saat instalasi pilih **Use WSL 2 based engine** (default & disarankan). Kalau WSL2 belum aktif, installer akan minta restart untuk mengaktifkan Virtual Machine Platform + install kernel WSL.
2. **Git for Windows** — https://git-scm.com/download/win (pilih semua default)
3. (Opsional) **Windows Terminal** dari Microsoft Store agar PowerShell lebih nyaman.

Setelah install, buka Docker Desktop sampai statusnya **Running** (icon paus di system tray hijau).

### 2. Clone & Konfigurasi
Buka **PowerShell** (bukan CMD):
```powershell
git clone <URL_REPO_KAMU> C:\kasirku
cd C:\kasirku

Copy-Item backend\.env.example backend\.env
Copy-Item frontend\.env.example frontend\.env

# Generate JWT secret 64-char hex
$secret = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
Write-Host "JWT_SECRET=$secret"
```
Buka `backend\.env` di **Notepad** atau **VS Code** dan isi minimal:
- `JWT_SECRET` (paste dari output di atas)
- `ADMIN_EMAIL` dan `ADMIN_PASSWORD`
- `EMERGENT_LLM_KEY` (opsional — hanya kalau butuh upload QRIS/foto)

Bikin file `.env` di root (untuk docker-compose):
```powershell
@"
POSTGRES_USER=kasirku
POSTGRES_PASSWORD=gantiPasswordKuat123
POSTGRES_DB=kasirku
PUBLIC_URL=http://localhost:8080
"@ | Out-File -Encoding utf8 .env
```

Sinkronkan `DATABASE_URL` di `backend\.env` dengan password di atas:
```
DATABASE_URL="postgresql+asyncpg://kasirku:gantiPasswordKuat123@postgres:5432/kasirku"
```

### 3. Jalankan
```powershell
docker compose up -d --build
docker compose ps
docker compose logs -f backend
```
Tekan `Ctrl+C` di log untuk keluar (container tetap jalan di background).

Aplikasi tersedia di:
- **Owner dashboard**: http://localhost:8080

Login pakai `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Owner default akan di-seed otomatis + tabel di-migrate oleh Alembic saat container backend pertama kali start.

### 4. HTTPS untuk Uji dari HP Kasir (WAJIB untuk Web Bluetooth)
Web Bluetooth (dan `BarcodeDetector` camera scan) **butuh HTTPS**. Localhost hanya jalan di komputer yang sama — HP kasir butuh URL HTTPS. Dua opsi termudah tanpa VPS:

**A) Cloudflare Tunnel (gratis, tidak perlu port forward)**
```powershell
winget install --id Cloudflare.cloudflared
# Tunnel sementara — dapat sub-domain acak trycloudflare.com
cloudflared tunnel --url http://localhost:8080
```
Copy URL `https://xxxxx.trycloudflare.com`, buka di HP Android — Web Bluetooth aktif.

Untuk domain permanen: `cloudflared tunnel login` → `cloudflared tunnel create kasirku` → ikuti wizard di https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/.

**B) ngrok (mudah, gratis untuk uji)**
```powershell
winget install ngrok.ngrok
ngrok config add-authtoken <token dari dashboard ngrok>
ngrok http 8080
```
Copy URL `https://xxxx.ngrok.app` → buka di HP kasir.

> Setelah dapat URL HTTPS, edit `frontend\.env` → `REACT_APP_BACKEND_URL=https://xxxx.ngrok.app` lalu `docker compose up -d --build frontend`.

### 5. Update / Restart
```powershell
cd C:\kasirku
git pull
docker compose up -d --build
```

### 6. Backup Postgres di Windows
```powershell
$date = Get-Date -Format "yyyy-MM-dd"
docker exec kasirku-postgres pg_dump -U kasirku -d kasirku -Fc > "C:\backups\kasirku-$date.dump"
```
Jadwalkan via **Task Scheduler** (`taskschd.msc`) — Actions → Start a program → `powershell.exe -File C:\kasirku\backup.ps1`.

Restore:
```powershell
Get-Content C:\backups\kasirku-2026-02-18.dump | docker exec -i kasirku-postgres pg_restore -U kasirku -d kasirku --clean --if-exists
```

### Troubleshooting Windows
- **`docker: command not found`** — Docker Desktop belum jalan atau belum reboot setelah install. Buka Docker Desktop dari Start Menu.
- **`WSL 2 installation is incomplete`** — Jalankan di PowerShell admin: `wsl --install` lalu restart.
- **Port 8080 dipakai aplikasi lain** — Ubah `ports: - "8080:80"` di `docker-compose.yml` ke port lain (mis. `9090:80`), lalu update `PUBLIC_URL` sesuai.
- **Cetak thermal / scan kamera tidak jalan di HP** — pastikan sudah buka via URL HTTPS (Cloudflare Tunnel/ngrok), bukan IP lokal `http://192.168.x.x`.
- **Container sering restart** — Cek RAM Docker Desktop: Settings → Resources → Memory ≥ 4 GB.

---

## Development Lokal (tanpa Docker)```bash
# 1. Jalankan Postgres via docker
docker run -d --name kasirku-pg -p 5432:5432 \
  -e POSTGRES_USER=kasirku -e POSTGRES_PASSWORD=kasirku_dev -e POSTGRES_DB=kasirku \
  postgres:16-alpine

# 2. Backend
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# .env-mu harus punya:
# DATABASE_URL="postgresql+asyncpg://kasirku:kasirku_dev@localhost:5432/kasirku"
uvicorn server:app --host 0.0.0.0 --port 8001 --reload

# 3. Frontend
cd frontend
yarn install
yarn start
```

---

## Troubleshooting

**Backend gagal start: `Connect call failed ('127.0.0.1', 5432)`**
- Postgres belum ready. `docker-compose` sudah `depends_on: service_healthy`, tapi kalau jalankan manual pastikan Postgres up dulu.
- Cek log: `docker compose logs postgres`

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
- Cek transaksi tersimpan:
  ```bash
  docker exec -it kasirku-postgres psql -U kasirku -d kasirku -c "SELECT id, total, payment_method, created_at FROM transactions ORDER BY created_at DESC LIMIT 10;"
  ```

**Postgres size / performance**
- Vacuum + reindex berkala: `docker exec -it kasirku-postgres psql -U kasirku -d kasirku -c "VACUUM ANALYZE;"`
- Arsip transaksi lama: `DELETE FROM transactions WHERE created_at < '2025-01-01';`

---

## Lisensi
Internal / private. Sesuaikan dengan kebutuhanmu.
