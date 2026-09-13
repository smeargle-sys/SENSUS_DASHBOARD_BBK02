# Sensus Jiwa & Jamaah Kelompok Babakan Barat
Aplikasi Web dan Manajemen Database Sensus Kelompok Babakan Barat, Desa Babakan, Tangerang Selatan.

Aplikasi ini menggunakan **Google Sheets** sebagai database utama (back-end) dan **Google Apps Script** untuk menyajikan dashboard interaktif dan form input data jamaah baru secara dinamis dan responsif.

---

## 🚀 Fitur Utama
1. **Otomatisasi Kategori Usia (Rule Engine)**: Kategori usia (BALITA-PAUD, CABERAWIT, PRA REMAJA, REMAJA, PRA NIKAH, DEWASA MENIKAH) dihitung secara dinamis dari **Tahun Lahir** dan **Status Pernikahan** saat data dimuat.
2. **Kalkulasi Lansia Otomatis**: Menampilkan jumlah jamaah Lansia (usia $\ge 57$ tahun) secara real-time pada dashboard statistik atas.
3. **Database Relasional & Ramping**: Menghilangkan puluhan kolom centang manual di spreadsheet asal dengan memisahkan data menjadi dua tab sheet relasional (`Keluarga` dan `Jamaah`).
4. **Form Input Interaktif**: Form pembuatan Kartu Keluarga (KK) baru atau penambahan anggota jamaah baru dengan validasi instan.
5. **Daftar & Filter Multi-Dimensi**: Pencarian jamaah secara instan dan filter berdasarkan Kategori Usia, Gender, Keaktifan Wilayah, serta Daftar Kehadiran (Absen).
6. **Script Migrasi Instan**: Memindahkan data dari format spreadsheet lama ke format relasional baru secara otomatis.

---

## 📁 Struktur Berkas Proyek
*   `Code.gs`: Logika backend utama Google Apps Script (interaksi Spreadsheet, rule engine, rekap statistik, penyimpanan data, & migrasi).
*   `index.html`: Kode tampilan frontend tunggal (SPA) bertema terang (*light theme*) profesional, bersih, dan responsif.
*   `simulate_local.js`: Lingkungan pengujian offline lokal berbasis Node.js untuk mensimulasikan Apps Script.

---

## 🛠️ Panduan Pengembangan Lokal
Untuk menguji logika backend (`Code.gs`) secara offline di komputer Anda:
1. Pastikan Anda memiliki [Node.js](https://nodejs.org/) terinstal di sistem Anda.
2. Jalankan perintah simulasi di terminal:
   ```bash
   node simulate_local.js
   ```
3. Script simulasi akan memuat mockup data, memvalidasi perhitungan usia, kategori usia, status Duda/Janda, lansia, serta memverifikasi proses simpan data baru.

---

## 🌐 Panduan Pemasangan Live ke Google Sheets

### Langkah 1: Siapkan Google Spreadsheet Anda
1. Buat Google Spreadsheet baru di Google Drive Anda.
2. Buat dua tab sheet dengan nama persis sebagai berikut:
   *   Tab pertama: **`Keluarga`**
   *   Tab kedua: **`Jamaah`**
3. Tulis header berikut pada baris pertama masing-masing sheet:
   *   **Sheet `Keluarga`** (Kolom A-D):
       `ID Keluarga` | `Nama KK` | `Alamat` | `No Telepon`
   *   **Sheet `Jamaah`** (Kolom A-L):
       `ID Jamaah` | `ID Keluarga` | `Hubungan Keluarga` | `Nama Lengkap` | `Nama Absen` | `Jenis Kelamin` | `Tahun Lahir` | `Status Nikah` | `Status Keaktifan` | `Flag Absen` | `Status Keberadaan` | `Catatan`
4. Salin **URL Google Spreadsheet** tersebut dari browser.

### Langkah 2: Buat Google Apps Script
1. Pada Google Spreadsheet Anda, buka menu **Extensions (Ekstensi)** -> **Apps Script**.
2. Hapus seluruh kode default di dalam `Code.gs` dan ganti dengan isi berkas `Code.gs` dari repositori ini.
3. Di baris awal `Code.gs`, isi variabel `FALLBACK_URL` dengan URL spreadsheet Anda:
    ```javascript
    FALLBACK_URL: "https://docs.google.com/spreadsheets/d/ID_SPREADSHEET_ANDA/edit"
    ```
4. Buat file baru di Apps Script: klik tombol `+` -> Pilih **HTML** -> Beri nama **`index`** (tanpa ekstensi `.html`).
5. Hapus semua kode default di file `index.html` baru tersebut, lalu ganti dengan isi berkas `index.html` dari repositori ini.
6. Simpan proyek dengan menekan ikon Disket (Save).

### Langkah 3: Publikasikan Web App
1. Klik tombol **Deploy (Terapkan)** di kanan atas -> Pilih **New Deployment (Terapkan baru)**.
2. Klik ikon gir (Settings) -> Pilih **Web App (Aplikasi Web)**.
3. Atur pengaturannya:
   *   *Description*: Sensus Babakan Barat v1
   *   *Execute as*: **Me (Saya)**
   *   *Who has access*: **Anyone (Siapa saja)**
4. Klik **Deploy**.
5. Klik **Authorize Access** -> Pilih akun Google Anda -> Klik **Advanced (Lanjutan)** -> Klik **Go to Untitled project (Unsafe)** -> Klik **Allow (Izinkan)**.
6. Salin **Web App URL** yang diberikan:
   *   **Halaman Editor**: Akses langsung URL tersebut (contoh: `https://script.google.com/.../exec`).
   *   **Halaman Ringkasan Publik (Read-Only)**: Tambahkan parameter `?page=view` di akhir URL (contoh: `https://script.google.com/.../exec?page=view`). Halaman ini terbuka untuk siapa saja.

---

## 🔄 Panduan Migrasi Data Lama ke Format Baru
Jika Anda sudah memiliki data sensus lama di spreadsheet asal dan ingin memindahkannya secara otomatis ke format tabel baru ini:

1. Buat tab sheet baru bernama **`Sensus_Asal`** di Google Spreadsheet Anda.
2. Salin seluruh data sensus lama Anda ke dalam sheet tersebut.
3. Pastikan struktur kolom di sheet `Sensus_Asal` berurutan tepat dari kolom **A** hingga **L** seperti di bawah ini:
   *   **A**: Nomor (`No` - 1, 2, 3...)
   *   **B**: Status Aktif (`Aktif` - Y/N)
   *   **C**: `Nama Lengkap`
   *   **D**: `Nama di Absen`
   *   **E**: Hubungan Keluarga (`A` = KK/Bapak, `B` = Istri, `C` = Anak, `D` = Bukan Inti)
   *   **F**: Jenis Kelamin (`Jenis Kelamin` - L/P)
   *   **G**: Tahun Lahir (`TTL` - Cukup tahun lahir saja, misal `1997`)
   *   **H**: `Umur` (Boleh rumus atau kosong karena akan dihitung otomatis)
   *   **I**: Penanda Absen (`Absen` - Y/N/Mondok/Tugas/Kerja Luar)
   *   **J**: Kategori Usia (Boleh isi/kosong)
   *   **K**: Status Pernikahan (`Status` - MENIKAH/JANDA/DUDA/atau kosong)
   *   **L**: `Catatan`
4. Di Google Apps Script Editor Anda, pilih fungsi **`jalankanMigrasiSensus`** pada pilihan run di bagian atas.
5. Klik tombol **Run (Jalankan)**.
6. Script akan otomatis membagi data Anda menjadi KK unik pada sheet `Keluarga` dan anggota individu pada sheet `Jamaah` dengan penanda keaktifan wilayah dan flag absensi yang sesuai.
7. Anda dapat menghapus tab sheet `Sensus_Asal` setelah proses verifikasi data selesai.
