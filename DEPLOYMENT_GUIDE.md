# Panduan Deploy ke Google Apps Script

## Masalah
Search field "Pilih Keluarga (KK)" tidak muncul - masih menampilkan dropdown lama.

## Penyebab
Kode di Google Apps Script editor belum ter-update dengan versi terbaru dari GitHub.

## Solusi: Deploy Ulang ke GAS

### Step 1: Buka Google Apps Script Editor
1. Buka tautan GAS Anda:
   ```
   https://script.google.com/macros/s/AKfycbwEbPsEW0v-V832Wo9FYVMwcCs7PXurP1w5SAq8tCIw5pqx9RAKsqvH0Gjuar5pJqHB/exec
   ```

2. Klik **Edit** (ikon pensil di kanan atas) atau buka Google Apps Script project

3. Di sidebar kiri, Anda akan melihat:
   - `Code.gs`
   - `index.html`
   - `view.html`

### Step 2: Update Code.gs
1. Klik tab `Code.gs`
2. **Select All** (Ctrl+A atau Cmd+A)
3. **Delete** semua isi
4. Copy seluruh isi dari:
   https://raw.githubusercontent.com/smeargle-sys/SENSUS_DASHBOARD_BBK02/main/Code.gs
5. Paste ke Code.gs di GAS editor

### Step 3: Update index.html
1. Klik tab `index.html`
2. **Select All** (Ctrl+A atau Cmd+A)
3. **Delete** semua isi
4. Copy seluruh isi dari:
   https://raw.githubusercontent.com/smeargle-sys/SENSUS_DASHBOARD_BBK02/main/index.html
5. Paste ke index.html di GAS editor

### Step 4: Update view.html
1. Klik tab `view.html`
2. **Select All** (Ctrl+A atau Cmd+A)
3. **Delete** semua isi
4. Copy seluruh isi dari:
   https://raw.githubusercontent.com/smeargle-sys/SENSUS_DASHBOARD_BBK02/main/view.html
5. Paste ke view.html di GAS editor

### Step 5: Deploy Ulang
1. Klik tombol **Deploy** (di kanan atas, mungkin ada ikon cloud/rocket)
2. Pilih **New Deployment**
3. Isi form:
   - **Type**: Web app
   - **Execute as**: Your account (email Anda)
   - **Who has access**: Anyone
4. Klik **Deploy**
5. Copy URL baru atau gunakan URL lama Anda

### Step 6: Hard Refresh Browser
1. Buka URL deployment di browser
2. **Tekan Ctrl+Shift+R** (Windows/Linux) atau **Cmd+Shift+R** (Mac)
3. Atau buka URL di incognito/private tab baru

### Expected Result
- Sekarang field "Pilih Keluarga (KK)" harus menampilkan **text input** bukan dropdown
- Ketika Anda ketik nama KK atau alamat, hasil filter muncul di bawah
- Click hasil untuk select keluarga

## Troubleshooting

### Masih melihat dropdown lama?
- ✅ Pastikan hard refresh benar-benar ter-execute
- ✅ Coba buka di tab incognito/private
- ✅ Clear browser cache: DevTools → Application → Storage → Clear All
- ✅ Tunggu 2-3 menit untuk GAS cache terupdate

### JavaScript error di console?
- Buka **F12 → Console**
- Screenshot error message dan hubungi developer

### Form tidak load sama sekali?
- Cek **F12 → Console** untuk error
- Pastikan URL deployment benar
- Pastikan deploy ke **Web app** bukan library

## File yang Dimodifikasi
- `Code.gs` - Backend, Google Sheets API
- `index.html` - Admin dashboard dengan semantic search
- `view.html` - Public view dengan filter

## Fitur Baru
✨ **Semantic Search untuk Keluarga (KK)**
- Real-time text filtering saat ketik
- Support pencarian nama KK dan alamat
- Fuzzy matching untuk typo tolerance
- Max height 300px dengan scroll jika hasil banyak

---

**Butuh bantuan?** Hubungi developer atau cek console untuk error details.
