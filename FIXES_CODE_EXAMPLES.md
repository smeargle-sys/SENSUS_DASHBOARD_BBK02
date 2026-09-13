# 💻 Quick Fix Code Examples

Ready-to-use code snippets to fix the most critical issues.

---

## 1. Fix XSS Vulnerability

### ❌ VULNERABLE CODE (Current)
```javascript
// index.html line 785
tr.innerHTML = `
  <td style="color: var(--text-muted); text-align: center;">${index + 1}</td>
  <td style="font-weight: 600;">${j.nama_lengkap}</td>
  <td>${j.nama_absen}</td>
  <!-- More cells with user data -->
`;
```

### ✅ SAFE CODE (Fixed)
```javascript
// Safe approach - build DOM elements instead of string concatenation
tr.innerHTML = ''; // Clear first

const cells = [
  { text: String(index + 1), style: "color: var(--text-muted); text-align: center;" },
  { text: j.nama_lengkap, style: "font-weight: 600;" },
  { text: j.nama_absen, style: "" },
  { text: j.hubungan_keluarga, style: "text-align: center;" },
  { text: j.nama_kk, style: "" },
  { text: j.kategori_usia, style: "" },
  { text: j.umur + " th", style: "text-align: center;" },
  { text: j.is_aktif, style: "text-align: center;" },
  { text: j.flag_absen, style: "text-align: center;" }
];

cells.forEach(cell => {
  const td = document.createElement('td');
  td.textContent = cell.text; // Use textContent, not innerHTML
  if (cell.style) td.setAttribute('style', cell.style);
  tr.appendChild(td);
});
```

### 🛡️ Even Better - Use DOMPurify Library
```javascript
// Add to HTML head:
// <script src="https://cdn.jsdelivr.net/npm/dompurify@3.0.6/dist/purify.min.js"></script>

tr.innerHTML = DOMPurify.sanitize(`
  <td>${j.nama_lengkap}</td>
  <td>${j.nama_absen}</td>
`);
```

---

## 2. Add Form Validation

### ✅ Client-Side Validation (Add to index.html)
```javascript
function validateFormData() {
  const errors = [];
  
  // Required fields
  if (!document.getElementById('form-nama-lengkap').value.trim()) {
    errors.push('Nama Lengkap harus diisi');
  }
  
  const tahun = parseInt(document.getElementById('form-tahun-lahir').value);
  const currentYear = new Date().getFullYear();
  
  // Year validation
  if (!tahun || tahun < 1900 || tahun > currentYear) {
    errors.push(`Tahun Lahir harus antara 1900 dan ${currentYear}`);
  }
  
  // Gender validation
  const gender = document.getElementById('form-jenis-kelamin').value;
  if (!['L', 'P'].includes(gender)) {
    errors.push('Jenis Kelamin harus L atau P');
  }
  
  // Phone validation (optional but if provided, must be valid)
  const phone = document.getElementById('form-telepon').value;
  if (phone && !/^(?:\+62|0)[0-9]{8,12}$/.test(phone.replace(/\D/g, '08'))) {
    errors.push('Nomor Telepon tidak valid');
  }
  
  // Marital status validation
  const statusNikah = document.getElementById('form-status-nikah').value;
  if (statusNikah && !['MENIKAH', 'DUDA', 'JANDA', 'BELUM'].includes(statusNikah)) {
    errors.push('Status Pernikahan tidak valid');
  }
  
  // Check if NEW keluarga selected without details
  if (document.getElementById('form-id-keluarga').value === 'NEW') {
    if (!document.getElementById('form-nama-kk').value.trim()) {
      errors.push('Nama Kepala Keluarga harus diisi untuk keluarga baru');
    }
    if (!document.getElementById('form-alamat').value.trim()) {
      errors.push('Alamat harus diisi untuk keluarga baru');
    }
  }
  
  return errors;
}

// Update handleFormSubmit to use validation
function handleFormSubmit(event) {
  event.preventDefault();
  
  // Validate form
  const errors = validateFormData();
  if (errors.length > 0) {
    alert('Perbaiki error berikut:\n\n' + errors.join('\n'));
    return;
  }
  
  // Continue with save...
  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;
  submitBtn.querySelector('span').innerText = "Menyimpan...";
  
  // ... rest of function
}
```

### ✅ Server-Side Validation (Add to Code.gs)
```javascript
function validateSensusData(formData) {
  const errors = [];
  
  // Check required fields
  if (!formData.nama_lengkap || !formData.nama_lengkap.trim()) {
    errors.push('Nama Lengkap required');
  }
  
  // Validate year
  const tahun = parseInt(formData.tahun_lahir);
  const currentYear = new Date().getFullYear();
  if (!tahun || tahun < 1900 || tahun > currentYear) {
    errors.push('Invalid tahun_lahir: must be between 1900 and ' + currentYear);
  }
  
  // Validate gender enum
  if (!['L', 'P'].includes(formData.jenis_kelamin)) {
    errors.push('Invalid jenis_kelamin: must be L or P');
  }
  
  // Validate marital status enum
  const validStatuses = ['', 'MENIKAH', 'DUDA', 'JANDA', 'BELUM'];
  if (!validStatuses.includes(formData.status_nikah)) {
    errors.push('Invalid status_nikah: must be MENIKAH, DUDA, JANDA, or BELUM');
  }
  
  // Validate family relationship enum
  if (!['A', 'B', 'C', 'D'].includes(formData.hubungan_keluarga)) {
    errors.push('Invalid hubungan_keluarga: must be A, B, C, or D');
  }
  
  // Validate flags
  if (!['Y', 'N'].includes(formData.is_aktif)) {
    errors.push('Invalid is_aktif: must be Y or N');
  }
  
  if (!['Y', 'N'].includes(formData.flag_absen)) {
    errors.push('Invalid flag_absen: must be Y or N');
  }
  
  // For new keluarga, validate details
  if (formData.is_new_keluarga) {
    if (!formData.nama_kk || !formData.nama_kk.trim()) {
      errors.push('nama_kk required for new keluarga');
    }
    if (!formData.alamat || !formData.alamat.trim()) {
      errors.push('alamat required for new keluarga');
    }
  }
  
  return errors;
}

// Update saveSensusData to validate
function saveSensusData(formData) {
  // Validate data
  const errors = validateSensusData(formData);
  if (errors.length > 0) {
    throw new Error('Validation failed: ' + errors.join(', '));
  }
  
  // Normalize data (trim strings, coerce types)
  formData.nama_lengkap = String(formData.nama_lengkap).trim();
  formData.tahun_lahir = parseInt(formData.tahun_lahir);
  formData.jenis_kelamin = String(formData.jenis_kelamin).toUpperCase();
  // ... etc
  
  // Continue with save logic...
}
```

---

## 3. Add Debounce Filter

### ✅ Add Debounce Utility (Add to index.html script section)
```javascript
// Debounce utility function
function debounce(func, delay) {
  let timeoutId;
  return function(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      func.apply(this, args);
    }, delay);
  };
}

// Create debounced version of filterAndRenderTable
const debouncedFilter = debounce(filterAndRenderTable, 500);

// Update oninput event binding in HTML
// Change from: oninput="filterAndRenderTable()"
// To: oninput="debouncedFilter()"

// Or programmatically (better):
document.addEventListener('DOMContentLoaded', function() {
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    // Remove old listener if inline
    searchInput.oninput = null;
    // Add debounced listener
    searchInput.addEventListener('input', debouncedFilter);
  }
  
  // Same for other filter dropdowns
  ['filter-kategori', 'filter-gender', 'filter-aktif', 'filter-absen'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', debouncedFilter);
    }
  });
});
```

---

## 4. Fix Data Key Inconsistency

### ❌ WRONG (Current)
```javascript
// Code.gs
function getSensusData() {
  // ...
  return {
    success: true,
    data: {
      jamaah: jamaahData,
      keluarga: keluargaData,
      rekap: {
        kkCount: keluargaData.length,  // <-- Returns "kkCount"
        // ...
      }
    }
  };
}

// view.html
document.getElementById('kpi-kk').innerText = appData.rekap.kk; // <-- Reads "kk" → undefined!
```

### ✅ FIXED
```javascript
// Code.gs - Option 1: Use consistent key name
return {
  success: true,
  data: {
    jamaah: jamaahData,
    keluarga: keluargaData,
    rekap: {
      kk: keluargaData.length,  // Use "kk" consistently
      total: jamaahData.length,
      // ...
    }
  }
};

// Code.gs - Option 2: Include both names for compatibility
return {
  success: true,
  data: {
    jamaah: jamaahData,
    keluarga: keluargaData,
    rekap: {
      kk: keluargaData.length,
      kkCount: keluargaData.length,  // Backward compatible
      // ...
    }
  }
};
```

---

## 5. Add Error Recovery with Timeout

### ✅ Update loadData() Function (Add to index.html)
```javascript
function loadData() {
  document.getElementById('loading-state').style.display = 'block';
  document.getElementById('main-content').style.display = 'none';
  document.getElementById('error-state').style.display = 'none';

  // Set timeout for loading (30 seconds)
  const loadingTimeout = setTimeout(() => {
    showError('Waktu muat data habis (> 30 detik). Silakan coba lagi.');
  }, 30000);

  google.script.run
    .withSuccessHandler((res) => {
      clearTimeout(loadingTimeout); // Clear timeout on success
      
      document.getElementById('loading-state').style.display = 'none';
      if (res.success) {
        appData.jamaah = res.data.jamaah;
        appData.keluarga = res.data.keluarga;
        appData.rekap = res.data.rekap;
        document.getElementById('main-content').style.display = 'flex';
        populateKeluargaDropdown();
        renderRekapTable();
        filterAndRenderTable();
      } else {
        showError(res.message || 'Gagal memuat data');
      }
    })
    .withFailureHandler((err) => {
      clearTimeout(loadingTimeout); // Clear timeout on error
      document.getElementById('loading-state').style.display = 'none';
      showError('Error: ' + (err.message || err.toString()));
    })
    .getSensusData();
}
```

---

## 6. Extract Magic Numbers to Constants

### ✅ Add to Code.gs (Top of file)
```javascript
// === BUSINESS RULE CONSTANTS ===
const BUSINESS_RULES = {
  // Age categories (in years)
  AGE_CATEGORIES: {
    BALITA_PAUD: { max: 4 },        // 0-4 years
    CABERAWIT: { min: 5, max: 11 },  // 5-11 years
    PRA_REMAJA: { min: 12, max: 14 }, // 12-14 years (SMP)
    REMAJA: { min: 15, max: 16 },    // 15-16 years (SMA)
    PRA_NIKAH: { min: 17, max: 24 }, // 17-24 years
    DEWASA_MENIKAH: { min: 25 },     // 25+ years (married)
    LANSIA_THRESHOLD: 57              // 57+ years for elderly count
  },
  
  // Valid enum values
  VALID_GENDER: ['L', 'P'],
  VALID_MARITAL_STATUS: ['MENIKAH', 'DUDA', 'JANDA', 'BELUM'],
  VALID_RELATIONSHIP: ['A', 'B', 'C', 'D'],
  VALID_PRESENCE: ['Menetap', 'Mondok', 'Tugas', 'Kerja Luar'],
  
  // Flags
  ACTIVE_YES: 'Y',
  ACTIVE_NO: 'N'
};

// Then use in functions:
function dapatkanKategoriUsia(tahunLahir, statusNikah) {
  const umur = new Date().getFullYear() - tahunLahir;
  
  // Validate inputs
  if (!tahunLahir || umur < 0 || umur > 150) {
    return 'UNKNOWN';
  }
  
  // If person is not eligible for marriage by marital status
  if (statusNikah === 'MENIKAH') {
    if (umur >= BUSINESS_RULES.AGE_CATEGORIES.DEWASA_MENIKAH.min) {
      return 'Dewasa Menikah';
    }
    // Married but young - still categorize by age
  }
  
  // Categorize by age
  const rules = BUSINESS_RULES.AGE_CATEGORIES;
  if (umur <= rules.BALITA_PAUD.max) return 'BALITA-PAUD';
  if (umur >= rules.CABERAWIT.min && umur <= rules.CABERAWIT.max) return 'Caberawit';
  if (umur >= rules.PRA_REMAJA.min && umur <= rules.PRA_REMAJA.max) return 'Pra Remaja (SMP)';
  if (umur >= rules.REMAJA.min && umur <= rules.REMAJA.max) return 'Remaja (SMA)';
  if (umur >= rules.PRA_NIKAH.min && umur <= rules.PRA_NIKAH.max) return 'Usia (Pra) Menikah';
  if (umur >= rules.DEWASA_MENIKAH.min) return 'Dewasa Menikah';
  
  return 'UNKNOWN';
}

// Count lansia
const lansia = jamaah.filter(j => {
  const umur = new Date().getFullYear() - j.tahun_lahir;
  return umur >= BUSINESS_RULES.AGE_CATEGORIES.LANSIA_THRESHOLD;
}).length;
```

### ✅ Add to CSS (or separate CSS file)
```css
/* === DESIGN SYSTEM CONSTANTS === */
:root {
  /* Grid layouts */
  --grid-main-columns: 1fr 1.2fr;  /* Use instead of hardcoded grid-template-columns */
  --grid-5-columns: repeat(5, 1fr);
  --grid-responsive-threshold: 992px;
  
  /* Component sizes */
  --table-max-height: 500px;
  --dropdown-max-height: 300px;
  --chart-cutout: 65%;
  
  /* Timing */
  --animation-duration: 300ms;
  --loading-timeout: 30000ms;
  --filter-debounce: 500ms;
}

/* Use in CSS */
.grid-layout-2 {
  display: grid;
  grid-template-columns: var(--grid-main-columns);
  gap: 1.5rem;
}

.grid-5 {
  display: grid;
  grid-template-columns: var(--grid-5-columns);
  gap: 1.25rem;
}

@media (max-width: 992px) {
  .grid-layout-2 {
    grid-template-columns: 1fr;
  }
  
  .grid-5 {
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  }
}
```

---

## 7. Fix Authentication Issue (Code.gs)

### ✅ Add User Authentication Check
```javascript
var CONFIG = {
  SHEET_KELUARGA: "Keluarga",
  SHEET_JAMAAH: "Jamaah",
  ADMIN_EMAILS: ["admin@example.com", "coordinator@example.com"], // Add authorized users
  FALLBACK_URL: ""
};

function doGet(e) {
  const page = (e && e.parameter && e.parameter.page) || 'index';
  
  // Get current user
  const user = Session.getEffectiveUser();
  const userEmail = user ? user.getEmail() : null;
  
  // Check if viewing admin (editable) interface
  if (page !== 'view') { // 'view' is public read-only
    // Require authentication for admin views
    if (!userEmail || !CONFIG.ADMIN_EMAILS.includes(userEmail)) {
      return HtmlService.createHtmlOutput(
        '<h2>⛔ Akses Ditolak</h2>' +
        '<p>Anda tidak memiliki izin untuk mengakses halaman admin.</p>' +
        '<p>User: ' + (userEmail || 'Not logged in') + '</p>' +
        '<p>Hubungi administrator untuk mendapatkan akses.</p>' +
        '<style>body { font-family: Arial; margin: 2rem; color: #666; }</style>'
      )
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
        .addMetaTag('viewport', 'width=device-width, initial-scale=1');
    }
  }
  
  // Log access (optional audit trail)
  Logger.log('User ' + userEmail + ' accessed page: ' + page + ' at ' + new Date());
  
  // Serve appropriate view
  if (page === 'view') {
    return HtmlService.createHtmlOutputFromFile('view')
        .setTitle('Sensus Jiwa Kelompok Babakan Barat - Ringkasan Publik')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
        .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  
  return HtmlService.createHtmlOutputFromFile('index')
      .setTitle('Sensus Jiwa Kelompok Babakan Barat')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
```

---

## 8. Add Toast Notifications (UX Improvement)

### ✅ Add Toast HTML & CSS (Add to index.html)
```html
<!-- Add to body, near bottom -->
<div id="toast-container" style="position: fixed; top: 20px; right: 20px; z-index: 5000; max-width: 400px;"></div>

<style>
.toast {
  background: #ffffff;
  padding: 1rem 1.5rem;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 1rem;
  animation: slideIn 0.3s ease-out;
  min-width: 300px;
}

.toast.success {
  border-left: 4px solid #10b981;
  background: #f0fdf4;
}

.toast.error {
  border-left: 4px solid #ef4444;
  background: #fef2f2;
}

.toast.info {
  border-left: 4px solid #3b82f6;
  background: #eff6ff;
}

@keyframes slideIn {
  from {
    transform: translateX(400px);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

@keyframes slideOut {
  to {
    transform: translateX(400px);
    opacity: 0;
  }
}

.toast.hide {
  animation: slideOut 0.3s ease-out;
}
</style>

<script>
function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  
  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
  toast.innerHTML = `<span style="font-size: 1.2rem;">${icon}</span><span>${message}</span>`;
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add('hide');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Usage examples:
// showToast('Data berhasil disimpan!', 'success');
// showToast('Gagal menyimpan data', 'error');
// showToast('Memproses...', 'info', 5000);
</script>
```

### ✅ Update handleFormSubmit to Use Toast
```javascript
function handleFormSubmit(event) {
  event.preventDefault();
  
  // Validate
  const errors = validateFormData();
  if (errors.length > 0) {
    showToast('Perbaiki error: ' + errors[0], 'error', 5000);
    return;
  }
  
  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;
  showToast('Menyimpan data...', 'info');
  
  const formData = { /* ... */ };
  
  google.script.run
    .withSuccessHandler((res) => {
      submitBtn.disabled = false;
      if (res.success) {
        showToast('✓ Data berhasil disimpan!', 'success');
        resetForm();
        setTimeout(() => loadData(), 1000);
      } else {
        showToast('✗ Error: ' + res.message, 'error', 5000);
      }
    })
    .withFailureHandler((err) => {
      submitBtn.disabled = false;
      showToast('✗ Error: ' + err.toString(), 'error', 5000);
    })
    .saveSensusData(formData);
}
```

---

## Implementation Order

1. **First**: Fix XSS vulnerability
2. **Second**: Add form validation (client + server)
3. **Third**: Add authentication
4. **Fourth**: Add debounce for filters
5. **Fifth**: Add toast notifications
6. **Sixth**: Extract magic numbers to constants

All of these fixes are **backward compatible** and won't break existing functionality!

