# Sensus Jiwa & Jamaah Kelompok Babakan Barat
Aplikasi web untuk mengelola data sensus jamaah Kelompok Babakan Barat, Desa Babakan, Tangerang Selatan.

Datanya disimpan di **Google Sheets**, logika server berjalan di **Google Apps Script**, dan tampilannya bisa dibuka dari URL Apps Script atau dari **GitHub Pages**. Ada dua halaman:

| Halaman | File | Untuk | PIN |
|---|---|---|---|
| **Admin** | `index.html` | Tambah, edit, hapus data, dan pengaturan | `ADMIN_PIN` |
| **Ringkasan Pengurus** | `view.html` | Melihat rekap & daftar absen (read-only) | `VIEWER_PIN` atau `ADMIN_PIN` |

---

## 🚀 Fitur

### Akses & keamanan
- **Login dengan PIN.** Setiap permintaan ke server diperiksa dengan token sesi (berlaku maksimal 6 jam, atau sampai menekan **Keluar**).
- **Kunci tebakan PIN.** Setelah 5 kali PIN salah, login dikunci 15 menit.
- **Data dibatasi untuk pengurus.** Halaman ringkasan hanya menerima jamaah aktif yang masuk daftar absen, tanpa alamat, catatan, ID, dan penanda *Perlu dibantu*.
- **Anti-XSS & anti formula injection.** Semua teks dari sheet di-escape sebelum ditampilkan, data ditulis sebagai teks biasa, dan sel CSV yang diawali `= + - @` dinetralkan.

### Halaman admin
- **Dashboard:** kartu angka (jiwa aktif, KK aktif, laki-laki, perempuan, lansia), komposisi kategori usia L/P, kartu Keberadaan & Absen (bisa diklik untuk memfilter).
- **Daftar jamaah:**
  - Pencarian tepat di atas daftar (nama, nama absen, KK, atau no. telepon) dengan tombol **X** untuk mengosongkan.
  - Filter cepat: Semua, Aktif wilayah, Luar kota, Mondok, Masuk absen, Tidak absen, **Perlu dibantu**, **Perlu dilengkapi** (dengan jumlahnya).
  - Filter Kategori, Keberadaan, Gender, dan pilihan **Urutkan**.
  - **Kelompokkan per KK**: daftar dikelompokkan per keluarga, Kepala Keluarga paling atas. Baris Kepala Keluarga selalu berlatar hijau.
  - 25 baris per halaman dengan tombol halaman pertama, terakhir, dan nomor halaman.
  - **Cetak** dan **Ekspor CSV** sesuai filter, urutan, dan pengelompokan yang sedang dipakai.
- **Detail jamaah:** klik nama untuk melihat data lengkap, nomor telepon (tombol WhatsApp), dan anggota keluarga lainnya. Dari sini bisa langsung **Edit** atau **Hapus**.
- **Tambah / edit jamaah:** panel 3 langkah (Keluarga → Data diri → Status & absen), pratinjau kategori usia saat tahun lahir diisi, Duda/Janda menyesuaikan jenis kelamin.
- **Daftar Keluarga (KK):** jumlah anggota aktif, detail anggota, tambah anggota, dan hapus KK.
- **Perlu Dibantu:** penanda jamaah penerima santunan/bantuan kelompok, dengan menu dan filter tersendiri (hanya terlihat admin).
- **Pengaturan Kategori:** atur nama dan rentang umur kategori, termasuk Lansia (lihat bagian *Aturan kategori usia*).
- **Hapus dengan arsip:** data yang dihapus dipindah ke sheet arsip, bukan hilang (lihat bagian *Arsip & pemulihan*).

### Halaman ringkasan pengurus
- Kartu angka, bar komposisi, dan tabel rekap kategori usia format laporan (L, P, Jumlah, Proporsi, Total).
- Daftar absen dengan pencarian, filter, urutan, **Kelompokkan per KK**, dan halaman bernomor.
- Detail jamaah saat nama diklik, termasuk nomor telepon dengan tombol WhatsApp.
- **Cetak laporan** (mencetak seluruh daftar, bukan hanya halaman aktif) dan **Ekspor CSV**.
- Tampilan HP dengan tab *Rekap usia* / *Daftar absen*.

> Nomor telepon tidak ditampilkan di daftar. Nomor hanya muncul di **detail** jamaah atau KK.

---

## 📐 Aturan kategori usia
Kategori dihitung otomatis dari **Tahun Lahir** dan **Status Nikah**:

1. **Menikah** → masuk kategori untuk yang menikah (default **Dewasa Menikah**).
2. **Duda / Janda** → dihitung di kolom Duda / Janda tersendiri.
3. **Belum menikah** → dicocokkan ke rentang umur di menu **Pengaturan Kategori**.

Bawaan rentang umur:

| Kategori | Umur |
|---|---|
| BALITA-PAUD | 0–5 th |
| Caberawit | 6–12 th |
| Pra Remaja (SMP) | 13–15 th |
| Remaja (SMA) | 16–17 th |
| Usia (Pra) Menikah | 18–56 th |
| Lansia | 57 th ke atas |

- Rentang harus **bersambung mulai umur 0**, dan kategori terakhir dibiarkan tanpa batas atas.
- Satu kategori bisa diberi tanda **Lansia**. Umur awalnya dipakai untuk kartu **"Lansia ≥ … th"**, yang menghitung jamaah aktif dari **semua status nikah**.
- Pengaturan disimpan di sheet `Pengaturan_Kategori` dan bisa diubah dari aplikasi atau langsung di sheet. Kalau isi sheet itu tidak valid, aplikasi memakai kategori bawaan dan menampilkan peringatan di halaman admin.
- **Perlu dilengkapi** = jamaah yang **tahun lahirnya belum diisi**, sehingga umur dan kategorinya belum bisa dihitung. Kalau jumlahnya 0, artinya semua data tahun lahir sudah lengkap.

---

## 🗂️ Struktur spreadsheet

| Sheet | Dibuat oleh | Isi |
|---|---|---|
| `Keluarga` | Anda / otomatis | Data KK |
| `Jamaah` | Anda / otomatis | Data jamaah |
| `Pengaturan_Kategori` | Otomatis | Aturan kategori usia |
| `Arsip_Jamaah` | Otomatis, saat hapus pertama | Jamaah yang dihapus |
| `Arsip_Keluarga` | Otomatis, saat hapus KK pertama | KK yang dihapus |
| `Sensus_Asal` | Anda (opsional) | Data lama untuk migrasi |

**Sheet `Keluarga`** (kolom A–D):
`ID Keluarga` | `Nama KK` | `Alamat` | `No Telepon`

**Sheet `Jamaah`:**
- **Kolom A–L harus berurutan:**
  `ID Jamaah` | `ID Keluarga` | `Hubungan Keluarga` | `Nama Lengkap` | `Nama Absen` | `Jenis Kelamin` | `Tahun Lahir` | `Status Nikah` | `Status Keaktifan` | `Flag Absen` | `Status Keberadaan` | `Catatan`
- **Kolom `No Telepon` dan `Perlu Dibantu`** dicari berdasarkan **nama header**, jadi letaknya bebas setelah kolom L. Kalau belum ada, aplikasi menambahkannya otomatis di kolom kosong berikutnya.
- **Kolom tambahan milik Anda** setelah kolom L (misalnya `Umur` berisi rumus) aman: tidak akan ditimpa saat menyimpan, menghapus, atau migrasi.
- Kalau isi kolom `No Telepon` ternyata bukan nomor telepon (misalnya angka umur), nilainya tidak ditampilkan dan admin mendapat peringatan. Biasanya ini berarti header kolom itu salah nama: kembalikan header ke nama aslinya.

**Kode isian:**
- `Hubungan Keluarga`: `A` Kepala, `B` Istri, `C` Anak, `D` Lainnya
- `Jenis Kelamin`: `L` / `P`
- `Status Nikah`: `BELUM`, `MENIKAH`, `DUDA`, `JANDA`
- `Status Keaktifan`, `Flag Absen`, `Perlu Dibantu`: `Y` / `N`
- `Status Keberadaan`: `Menetap`, `Mondok`, `Tugas`, `Kerja Luar`

---

## 🗄️ Arsip & pemulihan
Data yang dihapus dari aplikasi tidak hilang. Datanya dipindah ke tab arsip **di spreadsheet yang sama**:

- **`Arsip_Jamaah`** berisi jamaah yang dihapus.
- **`Arsip_Keluarga`** berisi KK yang dihapus.

Tiap baris arsip berisi **kolom A** Waktu Hapus, **kolom B** Keterangan, lalu **kolom C dst.** salinan utuh baris aslinya (termasuk kolom tambahan).

Aturan hapus:
- **Anggota biasa:** hanya orang itu yang dihapus.
- **Kepala Keluarga:** admin memilih **hapus kepalanya saja** (KK dan anggota lain tetap ada) atau **hapus seluruh KK** beserta semua anggotanya.
- **Dari Daftar Keluarga:** tombol hapus menghapus KK beserta semua anggotanya.

**Cara memulihkan data yang salah hapus:**
1. Buka tab `Arsip_Jamaah` dan cari barisnya.
2. Salin isi baris **mulai kolom C** sampai kolom terakhir.
3. Tempel di baris kosong pertama tab `Jamaah`, **mulai kolom A**.
4. Kalau yang terhapus seluruh KK, pulihkan juga baris KK-nya dari `Arsip_Keluarga` ke tab `Keluarga` dengan cara yang sama. Kalau tidak, anggotanya tampil "Tidak Terdaftar".
5. Muat ulang halaman admin.

---

## 🌐 Pemasangan di Google Apps Script

### Langkah 1: Siapkan spreadsheet
1. Buat Google Spreadsheet baru, atau pakai spreadsheet sensus yang sudah ada.
2. Pastikan ada tab **`Keluarga`** dan **`Jamaah`** dengan header seperti di bagian *Struktur spreadsheet*. Kalau belum ada, tab dan header-nya dibuat otomatis saat aplikasi pertama kali dibuka.

### Langkah 2: Pasang kode
1. Di spreadsheet, buka **Extensions (Ekstensi) → Apps Script**.
2. Ganti seluruh isi `Code.gs` dengan isi berkas `Code.gs` dari repositori ini.
3. Klik **+ → HTML**, beri nama **`index`** (tanpa `.html`), lalu isi dengan `index.html`.
4. Ulangi untuk file HTML **`view`** dengan isi `view.html`.
5. Simpan proyek.

`CONFIG.FALLBACK_URL` di `Code.gs` hanya perlu diisi URL spreadsheet kalau script **tidak** dibuat dari menu Extensions spreadsheet tersebut (script berdiri sendiri).

### Langkah 3: Atur PIN (wajib)
1. Buka **Project Settings (ikon gir) → Script Properties → Add script property**.
2. Tambahkan:
   - `ADMIN_PIN` → PIN admin, **minimal 6 digit**.
   - `VIEWER_PIN` → PIN pengurus, minimal 6 digit. Boleh dikosongkan kalau halaman ringkasan hanya untuk admin.
3. Simpan. PIN bisa diganti kapan saja. Sesi yang sudah login tetap berlaku sampai habis masa sesinya atau pengguna menekan **Keluar**.

### Langkah 4: Deploy sebagai Web App
1. **Deploy → New deployment → ikon gir → Web app**.
2. Atur:
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
3. Klik **Deploy**, lalu izinkan akses (**Authorize access → pilih akun → Advanced → Go to … (unsafe) → Allow**).
4. Salin **Web app URL** (berakhiran `/exec`):
   - **Admin:** `https://script.google.com/macros/s/…/exec` → PIN Admin
   - **Ringkasan:** `https://script.google.com/macros/s/…/exec?page=view` → PIN Pengurus

**Setiap kali `Code.gs` atau file HTML di Apps Script diubah:** buka **Deploy → Manage deployments → Edit (pensil) → Version: New version → Deploy**. URL-nya tetap sama.

Kalau aplikasi di-embed di Google Sites atau situs lain, ubah `CONFIG.ALLOW_EMBED` menjadi `true`.

---

## 🌍 Akses lewat GitHub Pages (opsional)
Halaman admin dan ringkasan bisa dibuka dari GitHub Pages, sementara data tetap di Google Sheets lewat Apps Script. PIN dan pembatasan data tetap sama.

1. Selesaikan dulu pemasangan Apps Script di atas. Akses **Anyone** wajib, karena GitHub Pages memanggil server tanpa login Google.
2. Isi `config.js` dengan Web app URL:
   ```javascript
   window.SENSUS_CONFIG = {
     API_URL: "https://script.google.com/macros/s/AKfycb.../exec"
   };
   ```
   URL ini boleh publik; tanpa PIN server tidak memberikan data apa pun.
3. Di GitHub: **Settings → Pages → Deploy from a branch → `main` / `(root)` → Save**. Tunggu 1–2 menit.
4. Alamat akses:
   - **Admin:** `https://<username>.github.io/<nama-repo>/`
   - **Ringkasan:** `https://<username>.github.io/<nama-repo>/view.html`

Catatan:
- **Perubahan HTML** cukup di-push ke GitHub.
- **Perubahan `Code.gs`** tetap perlu *New version* di Apps Script. `config.js` tidak perlu diubah karena URL-nya tetap.
- Lewat API (`doPost`), server hanya menerima aksi `login`, `logout`, `getSensusData`, `saveSensusData`, `deleteJamaah`, `deleteKeluarga`, dan `saveKategoriConfig`. Fungsi migrasi tidak bisa dipanggil dari luar.
- GitHub Pages gratis hanya untuk repo **publik**. Jangan simpan data jamaah asli di repo.

---

## ⚙️ Pengaturan di `Code.gs` (`CONFIG`)

| Kunci | Default | Keterangan |
|---|---|---|
| `SESSION_TTL_SEC` | `21600` | Lama sesi login dalam detik (maksimum 6 jam) |
| `MAX_FAIL` | `5` | Jumlah PIN salah sebelum login dikunci |
| `LOCK_SEC` | `900` | Lama kunci login dalam detik (15 menit) |
| `MIN_PIN_LENGTH` | `6` | Panjang minimal PIN |
| `ALLOW_EMBED` | `false` | `true` bila di-embed di situs lain |
| `FALLBACK_URL` | `""` | URL spreadsheet untuk script yang berdiri sendiri |
| `BATAS_LANSIA` | `57` | Dipakai hanya bila tidak ada kategori bertanda Lansia |

---

## 🔄 Migrasi data lama (opsional)
Untuk memindahkan data sensus format lama ke struktur `Keluarga` + `Jamaah`:

1. Buat tab **`Sensus_Asal`** dan salin data lama ke sana dengan urutan kolom **A–L**:
   - **A** No · **B** Aktif (Y/N) · **C** Nama Lengkap · **D** Nama di Absen
   - **E** Hubungan (`A` KK, `B` Istri, `C` Anak, `D` Bukan inti) · **F** Jenis Kelamin (L/P)
   - **G** Tahun Lahir (mis. `1997`) · **H** Umur (boleh kosong)
   - **I** Absen (Y / N / Mondok / Tugas / Kerja Luar) · **J** Kategori Usia (boleh kosong)
   - **K** Status Nikah (MENIKAH / JANDA / DUDA / kosong) · **L** Catatan
2. Di Apps Script Editor, pilih fungsi **`jalankanMigrasiSensus`** lalu klik **Run**. Fungsi ini **hanya bisa dijalankan pemilik dari Editor**.
3. Sebelum menimpa, isi `Keluarga` dan `Jamaah` di-backup ke tab `Backup_Keluarga_<tanggal>` dan `Backup_Jamaah_<tanggal>`. Kalau `Sensus_Asal` kosong, tidak ada data yang diubah.
4. Baris yang perlu dicek (tahun lahir atau jenis kelamin tidak valid, anggota tanpa Kepala Keluarga di atasnya) tercantum di log eksekusi.
5. **Hapus tab `Sensus_Asal`** setelah dicek, supaya migrasi tidak tidak sengaja dijalankan ulang dan menimpa data terbaru.

---

## 🛠️ Pengembangan & pengujian lokal
1. Pasang [Node.js](https://nodejs.org/).
2. Jalankan uji backend:
   ```bash
   node simulate_local.js
   ```
   Script ini menguji login PIN dan kunci tebakan, pembatasan data pengurus, validasi input, aturan & pengaturan kategori, hapus + arsip, kolom tambahan milik pengguna, API `doPost`, dan migrasi. Semua harus ✔; kalau ada yang gagal, perintah keluar dengan kode 1.
3. Membuka `index.html` / `view.html` langsung di browser (tanpa `API_URL` di `config.js`) menjalankan **Mode Simulasi** dengan data fiktif, tanpa PIN.

> ⚠️ Repo ini publik. Jangan menaruh nama, alamat, atau nomor telepon jamaah asli di file mana pun di repo, termasuk data contoh.

---

## 📁 Berkas proyek

| Berkas | Isi |
|---|---|
| `Code.gs` | Backend Apps Script: PIN & sesi, baca/simpan/hapus data, arsip, kategori usia, rekap, API `doPost`, migrasi |
| `index.html` | Halaman admin |
| `view.html` | Halaman ringkasan pengurus |
| `config.js` | `API_URL` untuk akses lewat GitHub Pages |
| `simulate_local.js` | Uji otomatis backend secara offline (Node.js) |
| `.nojekyll` | Supaya GitHub Pages menyajikan berkas apa adanya |

Berkas `REVIEW_SUMMARY.txt`, `TECHNICAL_REVIEW.md`, `FIXES_CODE_EXAMPLES.md`, `ARCHITECTURE_REFACTORING.md`, `QUICK_START_IMPROVEMENTS.md`, `DEPLOYMENT_GUIDE.md`, dan `DOCUMENTATION_INDEX.md` adalah catatan review lama. Isinya sudah tidak sesuai dengan kode sekarang; gunakan README ini sebagai acuan.