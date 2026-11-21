# 📖 Manual Book Operator - Sensus Jiwa & Jamaah

**Panduan Lengkap untuk Pengurus dalam Menggunakan Sistem Sensus Kelompok Babakan Barat**

---

## 🚀 Quick Start (Mulai Cepat)

### Akses Sistem Sekarang

**Admin (Edit Data):**
- 🔗 Link: https://smeargle-sys.github.io/SENSUS_DASHBOARD_BBK02/
- 📱 Atau scan QR (jika tersedia)
- 🔑 PIN: `A21112026#!`

**View (Lihat Laporan):**
- 🔗 Link: https://smeargle-sys.github.io/SENSUS_DASHBOARD_BBK02/view.html
- 📊 Tidak perlu login
- 📥 Bisa export CSV & print

**Tersimpan di Bookmark:**
- Tekan **Ctrl+D** (Windows) atau **Cmd+D** (Mac) untuk save di bookmark

---

## 📋 Daftar Isi

1. [Quick Start](#-quick-start-mulai-cepat)
2. [Intro & Akses](#intro--akses)
3. [Login dengan PIN](#login-dengan-pin)
4. [Dashboard Utama](#dashboard-utama)
5. [Menambah Data Jamaah Baru](#menambah-data-jamaah-baru)
6. [Mengedit Data Jamaah](#mengedit-data-jamaah)
7. [Mengelola Keluarga (KK)](#mengelola-keluarga-kk)
8. [Fitur Pencarian Semantik](#fitur-pencarian-semantik)
9. [Lihat Laporan & Statistik](#lihat-laporan--statistik)
10. [FAQ & Troubleshooting](#faq--troubleshooting)
11. [Kontak Support](#kontak-support)

---

## Intro & Akses

### URL Akses Sistem

**Admin (Edit Data) - Default Login:**
```
https://smeargle-sys.github.io/SENSUS_DASHBOARD_BBK02/
```
Atau alternatif Google Apps Script:
```
https://script.google.com/macros/s/AKfycbwEbPsEW0v-V832Wo9FYVMwcCs7PXurP1w5SAq8tCIw5pqx9RAKsqvH0Gjuar5pJqHB/exec
```

**Public View (Lihat Saja):**
```
https://smeargle-sys.github.io/SENSUS_DASHBOARD_BBK02/view.html
```
Atau alternatif Google Apps Script:
```
https://script.google.com/macros/s/AKfycbwEbPsEW0v-V832Wo9FYVMwcCs7PXurP1w5SAq8tCIw5pqx9RAKsqvH0Gjuar5pJqHB/exec?page=view
```

### 📌 URL yang Direkomendasikan (GitHub Pages)

Gunakan URL GitHub Pages untuk akses cepat dan stabil:

| Tujuan | URL | Catatan |
|--------|-----|---------|
| **Admin/Edit** | https://smeargle-sys.github.io/SENSUS_DASHBOARD_BBK02/ | Default login admin |
| **View/Laporan** | https://smeargle-sys.github.io/SENSUS_DASHBOARD_BBK02/view.html | Read-only, no login |

**Catatan Teknis:**
- GitHub Pages URL lebih cepat & stabil dari Google Apps Script
- Gunakan GitHub Pages untuk akses sehari-hari
- Google Apps Script URL sebagai backup jika GitHub Pages down
- Data tetap tersimpan di Google Sheets (tidak di GitHub)

### Level Akses

| Level | PIN | Fungsi |
|-------|-----|--------|
| **ADMIN** | A21112026#! | Tambah, edit, hapus data jamaah & keluarga |
| **VIEWER** | v21112026#? | Hanya lihat & ekspor laporan (read-only) |

---

## Login dengan PIN

### Step 1: Buka URL Sistem

**Untuk Edit Data (Admin):**
```
https://smeargle-sys.github.io/SENSUS_DASHBOARD_BBK02/
```

**Untuk Lihat Data (View):**
```
https://smeargle-sys.github.io/SENSUS_DASHBOARD_BBK02/view.html
```

Tekan **Enter** atau klik link di atas.

### Step 2: Masuk PIN

Sistem akan meminta **PIN** saat pertama kali akses halaman admin.

Masukkan PIN sesuai level akses Anda:
- **ADMIN:** `A21112026#!` (untuk edit data)
- **VIEWER:** `v21112026#?` (untuk lihat data saja)

**Catatan:** Halaman view.html tidak perlu PIN (public access).

### Step 3: Klik Login

Setelah masukkan PIN:
1. Klik tombol **"Login"**
2. Atau tekan **Enter**

### Step 4: Akses Dashboard

✅ Sekarang Anda dapat mengakses dashboard sesuai akses level Anda

---

## Bookmark/Simpan URL

**Untuk kemudahan akses, simpan URL di bookmark browser Anda:**

**Chrome/Firefox:**
1. Buka URL admin atau view
2. Tekan **Ctrl+D** (Windows) atau **Cmd+D** (Mac)
3. Klik **Save** atau **Add Bookmark**
4. Next time, tinggal klik bookmark

**Mobile (Smartphone):**
1. Buka URL di browser
2. Tap menu (⋮ atau ≡)
3. Tap **Add to Home screen** atau **Bookmark**
4. Akan ada shortcut di home screen

---

## Dashboard Utama

Setelah login, Anda akan melihat:

### Bagian Atas: KPI Statistics (Angka Penting)
```
┌─────────────────────────────────┐
│ Total Jamaah: 125 | KK: 30 | L: 62 | P: 63 | Lansia: 15 │
└─────────────────────────────────┘
```

- **Total Jamaah** = Jumlah seluruh anggota
- **Total KK** = Jumlah kepala keluarga
- **L** = Laki-laki
- **P** = Perempuan
- **Lansia** = Umur ≥ 57 tahun

### Bagian Tengah: Rekapitulasi Kategori Usia
Tabel yang menunjukkan distribusi anggota per kategori usia:
- BALITA-PAUD (0-5 tahun)
- Caberawit (6-12 tahun)
- Pra Remaja/SMP (13-15 tahun)
- Remaja/SMA (16-17 tahun)
- Usia (Pra) Menikah (18+)
- Dewasa Menikah

### Bagian Bawah: Form Input & Daftar Jamaah
- **Kiri:** Form untuk tambah/edit jamaah
- **Kanan:** Daftar jamaah dengan filter

---

## Menambah Data Jamaah Baru

### Step 1: Cari/Pilih Keluarga (KK)

**FITUR BARU: Pencarian Semantik**

Di field **"Pilih Keluarga (KK)"**, ketik untuk mencari:

```
Ketik nama KK atau alamat → Hasil muncul otomatis di bawah
```

**Contoh:**
- Ketik: `Sutardjo` → Akan muncul: "H. Sutardjo - Babakan Barat RT 01/02"
- Ketik: `Babakan` → Semua KK di alamat "Babakan Barat" muncul
- Ketik: `Daud` → Akan muncul: "Daud Wibisono - Babakan Barat RT 02/02"

Klik hasil yang sesuai untuk select keluarga.

### Step 2: Jika Keluarga Belum Ada → Buat Baru

Jika keluarga yang dicari **tidak ada**, akan muncul:
```
"Tidak ada hasil cocok. Buat Keluarga Baru"
```

Klik **"Buat Keluarga Baru"** untuk membuat KK baru.

Form akan menampilkan:
- Nama Kepala Keluarga (Bapak/Ibu)
- No. Telepon / WA
- Alamat Lengkap

Isi semua field, lalu lanjut ke step berikutnya.

### Step 3: Isi Data Jamaah

**Field yang harus diisi (*):**

| Field | Contoh | Keterangan |
|-------|--------|-----------|
| Nama Lengkap * | Sutardjo | Sesuai KTP/Akte |
| Nama di Absen * | Pak Jarjo | Nama panggilan untuk absen |
| Hubungan KK * | Kepala Keluarga | Pilih: Kepala KK / Istri / Anak / Lainnya |
| Jenis Kelamin * | Laki-Laki | Pilih: Laki-Laki atau Perempuan |
| Tahun Lahir * | 1956 | Misal: 1956, 1997, 2020 |
| Status Pernikahan | MENIKAH | Opsional: MENIKAH / DUDA / JANDA / Kosong |
| Status Keberadaan * | Menetap | Menetap / Mondok / Tugas / Kerja Luar |

**Field Tambahan:**

| Field | Pilihan | Default |
|-------|---------|---------|
| Aktif Wilayah | ☑️ Checked | Ya (aktif) |
| Masuk Absen | ☑️ Checked | Ya (absen) |
| Catatan | Text bebas | (kosong) |

### Step 4: Simpan Data

1. Klik tombol **"Simpan Data"** (berwarna hijau)
2. Tunggu notifikasi "✅ Data Berhasil Disimpan"
3. Form akan kosong otomatis, siap input data berikutnya

---

## Mengedit Data Jamaah

### Step 1: Cari Jamaah di Tabel

Di sebelah kanan, ada **tabel daftar jamaah** dengan:
- Search box: Ketik nama untuk cari
- Filter kategori usia
- Filter gender (L/P)

### Step 2: Klik Tombol Edit

Di setiap baris jamaah, ada tombol **"Edit"** (warna biru).

Klik tombol tersebut.

### Step 3: Form Otomatis Terisi

Form di kiri akan otomatis terisi dengan data jamaah yang dipilih.

### Step 4: Ubah Data

Edit field-field yang ingin diubah.

**Tips:**
- Jangan ubah Nama Lengkap jika sudah ter-input
- Anda bisa ubah tahun lahir, status nikah, dll
- Field yang tidak ingin diubah boleh dibiarkan

### Step 5: Simpan Perubahan

Klik **"Simpan Data"** untuk update data.

---

## Mengelola Keluarga (KK)

### Melihat Daftar Keluarga

Di dashboard, ada tabel **"Rekapitulasi Kategori Usia"** yang menampilkan jumlah KK.

### Menambah Keluarga Baru

Ada 2 cara:

**Cara 1: Via Form Tambah Jamaah**
- Di form, ketik nama KK yang tidak ada di search
- Klik "Buat Keluarga Baru"
- Isi data keluarga (nama kepala, alamat, telepon)
- Keluarga akan otomatis tersimpan saat Anda simpan data jamaah

**Cara 2: Langsung dari Admin** (contact admin jika perlu)

---

## Fitur Pencarian Semantik

### Apa itu Pencarian Semantik?

Fitur pencarian yang **pintar & fleksibel**:
- Tidak perlu ketik exact/pas persis
- Bisa partial (sebagian nama)
- Bisa fuzzy (toleran terhadap typo)

### Contoh Penggunaan

**Searching KK:**

```
Ketik: "Sut"      → Akan match: "Sutardjo"
Ketik: "Babakan"  → Akan match: semua alamat dengan "Babakan"
Ketik: "Daud"     → Akan match: "Daud Wibisono"
```

**Searching Jamaah:**

Di tabel daftar jamaah, gunakan search box untuk:
- Cari nama: `Sunarni`
- Cari KK: `H. Sutardjo`
- Cari alamat: `RT 01`

---

## Lihat Laporan & Statistik

### KPI Cards (Angka Ringkas)

Di atas dashboard, 5 kartu menunjukkan:
1. **Total Jamaah** - Jumlah anggota aktif
2. **Total KK** - Jumlah kepala keluarga
3. **Laki-Laki** - Jumlah gender L
4. **Perempuan** - Jumlah gender P
5. **Lansia** - Jumlah usia ≥ 57 tahun

### Tabel Rekapitulasi

Tabel besar menampilkan:
- Distribusi per kategori usia
- Distribusi gender (L/P) per kategori
- Jumlah Duda/Janda
- Total keseluruhan

### Visualisasi Data (Optional)

Tombol **"Tampilkan Visualisasi Data"** untuk melihat:
- Pie chart proporsi kategori
- Progress bar gender

### Ekspor Data

**Public View** (halaman baca-saja) memiliki tombol:
- **📥 Ekspor CSV** - Download data ke Excel
- **🖨️ Cetak Hasil** - Print halaman

---

## FAQ & Troubleshooting

### Q1: Lupa PIN, bagaimana?

**A:** Hubungi admin untuk reset PIN. PIN disimpan di Script Properties yang aman.

### Q2: Sistem loading terlalu lama

**A:** 
- Tunggu hingga 30 detik (timeout otomatis)
- Jika masih stuck, refresh halaman (F5)
- Cek koneksi internet Anda

### Q3: Error "Data keluarga tidak ada"

**A:**
- Pastikan Spreadsheet sudah ada data keluarga
- Hubungi admin untuk cek struktur sheet
- Coba refresh dan login ulang

### Q4: Tombol Simpan tidak berfungsi

**A:**
- Pastikan semua field (*) sudah diisi
- Cek internet connection
- Coba clear browser cache (Ctrl+Shift+Delete)

### Q5: Ingin lihat tapi tidak edit, bagaimana?

**A:**
- Gunakan **VIEWER PIN**: `v21112026#?`
- Atau akses halaman public: `...exec?page=view`
- Anda hanya bisa lihat dan ekspor, tidak bisa edit

### Q6: Ada field yang salah input, bisa diedit?

**A:**
- Ya! Klik tombol **"Edit"** di tabel daftar jamaah
- Form akan terisi otomatis
- Edit field yang salah
- Klik **"Simpan Data"**

### Q7: Bagaimana jika internet putus saat input?

**A:**
- Data akan hilang di form
- Tidak ada data tersimpan jika belum klik "Simpan Data"
- Silakan input ulang setelah internet normal

### Q8: Berapa kapasitas data yang bisa diinput?

**A:**
- Sistem bisa menampung ribuan record
- Untuk saat ini, fokus ke data Kelompok Babakan Barat (~200 orang)

---

## Kontak Support

Jika ada pertanyaan atau masalah:

| Kontak | Keterangan |
|--------|-----------|
| **Admin Developer** | Hubungi developer untuk technical issue |
| **Telepon** | (Hubungi admin) |
| **WhatsApp** | (Hubungi admin) |
| **Email** | (Hubungi admin) |

---

## Catatan Penting

⚠️ **JANGAN LAKUKAN:**
- Jangan share PIN dengan semua orang
- Jangan edit/hapus data yang tidak punya otoritas
- Jangan membuka data di public tempat

✅ **HARAP LAKUKAN:**
- Update data secara teratur
- Verifikasi data sebelum simpan
- Hubungi admin jika ada keraguan
- Logout setelah selesai (untuk keamanan)

---

## Changelog & Update

**Version 1.0 - 2026-01-01**
- ✨ Peluncuran sistem Sensus Jiwa & Jamaah
- 🔍 Fitur pencarian semantik untuk KK
- 📊 Dashboard dengan statistik real-time
- 🔐 Login dengan PIN untuk keamanan
- 📥 Export data ke CSV

---

**Terima kasih telah menggunakan sistem Sensus Jiwa & Jamaah Kelompok Babakan Barat!**

Semoga membantu dalam pendataan dan rekapitulasi data jemaah. 🙏

---

*Manual ini dibuat untuk mempermudah operator/pengurus dalam menggunakan sistem.*  
*Untuk update atau pertanyaan, silakan hubungi admin.*
