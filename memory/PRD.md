# KasirKu — POS Warung PWA

## Original Problem
Aplikasi POS untuk warung Indonesia: pembayaran tunai + QRIS statis, struk cetak thermal via Bluetooth (ESC/POS 58mm), laporan tutup toko ke WA pemilik via `wa.me`, multi-kasir. Kasir mobile-first (Android + Chrome, Web Bluetooth). Dashboard pemilik desktop.

## Personas
- **Pemilik warung** — buka dashboard di desktop/HP, kelola produk, kasir, QRIS, printer, laporan.
- **Kasir** — pakai HP Android, login PWA, transaksi cepat, cetak struk.

## Architecture
- Frontend: React (CRA) + Tailwind + shadcn/ui + Recharts + sonner + lucide-react. Fonts: Manrope (display) + Figtree (body). Colors: money green + action blue.
- Backend: FastAPI + Motor (MongoDB async), JWT auth (cookie + Bearer fallback), Emergent Object Storage for QRIS/product images.
- Thermal Print: Web Bluetooth GATT + custom ESC/POS byte encoder (58mm, 32 chars/line, cut command).

## Implemented (18 Feb 2026)
### Fase 1 — Auth + Setup
- Owner register/login, JWT + httpOnly cookie + localStorage token fallback
- Seed owner: achmadi291@gmail.com / admin123
- Multi-cashier CRUD by owner; tenant isolation via `owner_id` on all resources
- Onboarding wizard 4 langkah: info toko → upload QRIS → pairing printer → produk pertama

### Fase 2 — Kasir
- Mobile-first POS: search + category chips + product grid, cart drawer, decimal-qty modal untuk unit kg/ons
- Bayar Tunai (kembalian auto + quick-cash buttons) atau QRIS (tampil gambar statis + konfirmasi manual)
- Stok berkurang atomik ($inc), profit tercatat per transaksi

### Fase 3 — Thermal Print
- Web Bluetooth GATT connection, service auto-detect (3 UUID umum)
- ESC/POS byte encoder: header center+double, item lines dengan word-wrap, total double, footer, tanggal, kasir, partial cut
- Cetak Struk di layar sukses transaksi + Cetak Ulang dari Riwayat

### Fase 5 — Dashboard
- Kartu ringkasan (penjualan hari ini, transaksi, profit, 7 hari)
- Recharts area chart 7 hari (money green)
- List stok menipis
- Riwayat + detail transaksi

### Fase 6 — Tutup Toko
- Tombol besar di Dashboard → generate ringkasan → `wa.me/<owner_wa>?text=<report>` dibuka new tab

### Object Storage
- Upload QRIS + produk image via Emergent Object Storage
- Fetch dengan query-param auth token untuk `<img src>`
- File endpoint: JWT + tenant owner_id check

## Deferred / Backlog
- **Fase 4 — PWA + Offline sync (Dexie.js)** — P1
- Barcode scan, void/retur, diskon/promo — P2
- Notif pemilik untuk QRIS besar (anti-fraud) — P2
- Multi-cabang — P2
- Void transaction & audit log — P2
- Foto produk upload di UI (backend siap, UI belum) — P1
- WhatsApp Business API otomatis (bukan wa.me) — P2

## Test Credentials
Lihat `/app/memory/test_credentials.md`.
