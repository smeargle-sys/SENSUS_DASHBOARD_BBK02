# Script Properties Configuration

File ini mencatat konfigurasi Script Properties yang diperlukan di Google Apps Script untuk sistem PIN authentication.

## Cara Set Script Properties

1. Buka Google Apps Script Editor
   - URL: https://script.google.com/macros/s/AKfycbwEbPsEW0v-V832Wo9FYVMwcCs7PXurP1w5SAq8tCIw5pqx9RAKsqvH0Gjuar5pJqHB/exec

2. Klik **Project Settings** (di sidebar kiri)

3. Scroll ke section **Script Properties**

4. Klik **Add property** dan tambahkan:

## Script Properties yang Diperlukan

### 1. ADMIN_PIN (untuk Edit Data)
**Key:** `ADMIN_PIN`  
**Value:** `A21112026#!`

**Akses:** Pengurus yang dapat menambah/edit/hapus data jamaah dan keluarga

### 2. VIEWER_PIN (untuk Lihat Data)
**Key:** `VIEWER_PIN`  
**Value:** `v21112026#?`

**Akses:** Pengurus yang hanya dapat melihat dan mengekspor data (read-only)

---

## Contoh Input di Script Properties

```
Property Name          | Value
-----------------------|--------------------
ADMIN_PIN              | A21112026#!
VIEWER_PIN             | v21112026#?
```

---

## Cara Menggunakan di Code

Dalam `Code.gs`, gunakan:

```javascript
// Get Script Properties
var scriptProperties = PropertiesService.getScriptProperties();
var adminPin = scriptProperties.getProperty('ADMIN_PIN');
var viewerPin = scriptProperties.getProperty('VIEWER_PIN');

// Verifikasi PIN
if (inputPin === adminPin) {
  // Beri akses ADMIN (edit)
} else if (inputPin === viewerPin) {
  // Beri akses VIEWER (read-only)
} else {
  // Akses ditolak
}
```

---

## Keamanan

⚠️ **PENTING:**
- Jangan share PIN di public/GitHub
- Ganti PIN secara berkala (minimal 3 bulan sekali)
- PIN hanya disimpan di Script Properties (aman, tidak visible di URL)
- Setiap login tercatat di console (optional, bisa ditambahkan)

---

## Perubahan PIN

Jika ingin mengubah PIN:

1. Buka **Project Settings**
2. Cari property yang ingin diubah
3. Edit value-nya
4. Klik **Save**
5. Inform pengurus tentang PIN baru

---

**Last Updated:** 2026-01-01  
**Maintained By:** Development Team
