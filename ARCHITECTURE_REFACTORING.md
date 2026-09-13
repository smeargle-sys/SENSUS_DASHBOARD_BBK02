# 🏗️ Architecture Refactoring Guide

How to restructure the codebase for better maintainability, testability, and performance.

---

## Current Architecture Problems

```
❌ CURRENT STATE (Monolithic)

index.html (1002 lines)
├── CSS (600 lines) - All inline in <style>
├── HTML (250 lines) - Form + Table markup
└── JavaScript (400+ lines) - Mixed concerns
    ├── State management (appData, filters)
    ├── UI rendering (renderAll, filterAndRenderTable)
    ├── Event handlers (handleFormSubmit, editJamaah)
    └── Utility functions (filterKeluargaSearch, showToast)

view.html (1294 lines) - 95% duplicate of index.html
├── CSS (600 lines) - DUPLICATE
├── HTML (300 lines) - Mostly same
└── JavaScript (400 lines) - Different filtering rules

Code.gs (500+ lines)
├── Configuration
├── Data access layer (getSensusData)
├── Business logic (dapatkanKategoriUsia)
└── Data manipulation (saveSensusData, jalankanMigrasiSensus)
```

---

## ✅ RECOMMENDED ARCHITECTURE

### Phase 1: Code Organization (Low Risk)

#### Separate Concerns Within Current Files

```
index.html (Single source of truth for admin UI)
├── styles.css (external) - Shared between index & view
├── shared.js (external)
│   ├── Constants (BUSINESS_RULES, VALIDATORS)
│   ├── Utilities (debounce, formatters, DOM helpers)
│   └── UI Components (toast, modal, dropdown)
└── admin.js (external) - Admin-only logic
    ├── State management
    ├── Form validation
    ├── Event handlers
    └── Table rendering

view.html (Public view - minimal)
├── styles.css (same as above)
├── shared.js (same utilities)
└── public.js (external)
    ├── Read-only UI rendering
    ├── Filter logic (public-only rules)
    └── Analytics display

Code.gs (Backend - stays same)
├── Constants (CONFIG, BUSINESS_RULES - duplicated from JS)
├── API handlers (doGet, getSensusData, saveSensusData)
├── Business logic (dapatkanKategoriUsia, calculateStats)
└── Data access (getKeluargaData, getJamaahData)
```

### Phase 2: Module Pattern (Medium Risk)

Extract functionality into testable modules:

```javascript
// shared.js - Shared between admin and public views

// ============================================
// MODULE: State Management
// ============================================
const SensusState = (() => {
  let state = {
    jamaah: [],
    keluarga: [],
    rekap: {},
    filters: {
      searchQuery: '',
      kategori: '',
      gender: '',
      aktif: '',
      absen: ''
    },
    ui: {
      analyticsDashboardVisible: false,
      isLoading: false,
      currentPage: 'list'
    }
  };

  return {
    get: (path) => getNestedProperty(state, path),
    set: (path, value) => setNestedProperty(state, path, value),
    update: (updates) => Object.assign(state, updates),
    getState: () => structuredClone(state), // Deep copy
    subscribe: (callback) => observers.push(callback),
    notify: () => observers.forEach(cb => cb(state))
  };
})();

// ============================================
// MODULE: Validators
// ============================================
const SensusValidators = (() => {
  const rules = {
    nama_lengkap: (val) => val && val.trim().length > 0 ? null : 'Nama harus diisi',
    tahun_lahir: (val) => {
      const year = parseInt(val);
      const now = new Date().getFullYear();
      return year >= 1900 && year <= now ? null : `Tahun harus antara 1900-${now}`;
    },
    jenis_kelamin: (val) => ['L', 'P'].includes(val) ? null : 'Harus L atau P',
    // ... more validators
  };

  return {
    validate: (field, value) => rules[field]?.(value) ?? null,
    validateAll: (data) => {
      const errors = {};
      Object.entries(rules).forEach(([field, validator]) => {
        const error = validator(data[field]);
        if (error) errors[field] = error;
      });
      return Object.keys(errors).length ? errors : null;
    }
  };
})();

// ============================================
// MODULE: API Service
// ============================================
const SensusAPI = (() => {
  const DEFAULT_TIMEOUT = 30000;

  return {
    fetchData: (timeoutMs = DEFAULT_TIMEOUT) => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Request timeout'));
        }, timeoutMs);

        google.script.run
          .withSuccessHandler((res) => {
            clearTimeout(timeout);
            resolve(res);
          })
          .withFailureHandler((err) => {
            clearTimeout(timeout);
            reject(err);
          })
          .getSensusData();
      });
    },

    saveJamaah: (jamaahData) => {
      return new Promise((resolve, reject) => {
        // Validate before sending
        const errors = SensusValidators.validateAll(jamaahData);
        if (errors) {
          reject(new Error('Validation failed: ' + JSON.stringify(errors)));
          return;
        }

        google.script.run
          .withSuccessHandler(resolve)
          .withFailureHandler(reject)
          .saveSensusData(jamaahData);
      });
    },

    deleteJamaah: (jamaahId) => {
      return new Promise((resolve, reject) => {
        google.script.run
          .withSuccessHandler(resolve)
          .withFailureHandler(reject)
          .deleteSensusData(jamaahId);
      });
    }
  };
})();

// ============================================
// MODULE: UI Rendering (Reusable)
// ============================================
const SensusUI = (() => {
  return {
    renderTable: (data, options = {}) => {
      const tbody = document.getElementById('jamaah-table-rows');
      tbody.innerHTML = '';

      if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: #999;">Tidak ada data</td></tr>';
        return;
      }

      data.forEach((item, index) => {
        const tr = document.createElement('tr');
        const cells = [
          index + 1,
          item.nama_lengkap,
          item.nama_absen,
          item.hubungan_keluarga,
          item.nama_kk,
          item.kategori_usia,
          item.umur + ' th',
          item.is_aktif,
          item.flag_absen
        ];

        cells.forEach(cellData => {
          const td = document.createElement('td');
          td.textContent = cellData; // Safe from XSS
          tr.appendChild(td);
        });

        tbody.appendChild(tr);
      });

      lucide.createIcons();
    },

    renderChart: (data, containerId) => {
      const ctx = document.getElementById(containerId);
      if (!ctx) return;

      // Destroy existing chart
      const existingChart = Chart.instances.find(c => c.canvas.id === containerId);
      if (existingChart) existingChart.destroy();

      // Create new chart
      return new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: data.labels,
          datasets: [{
            data: data.values,
            backgroundColor: data.colors
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '65%'
        }
      });
    },

    showToast: (message, type = 'info', duration = 3000) => {
      // ... toast implementation
    },

    showModal: (title, content, actions = []) => {
      // ... modal implementation
    }
  };
})();

// ============================================
// USAGE EXAMPLE
// ============================================
async function loadData() {
  try {
    SensusState.set('ui.isLoading', true);
    const response = await SensusAPI.fetchData();
    
    SensusState.update({
      jamaah: response.data.jamaah,
      keluarga: response.data.keluarga,
      rekap: response.data.rekap,
      'ui.isLoading': false
    });
    
    SensusState.notify(); // Trigger subscribers
    renderUI();
  } catch (error) {
    SensusUI.showToast('Error: ' + error.message, 'error', 5000);
  }
}
```

### Phase 3: Full MVC Separation (High Risk - Long Term)

```
Backend (Code.gs) - No changes needed
├── API Layer (doGet, handles routing)
├── Data Layer (Sheet operations)
└── Business Logic (calculations, validations)

Frontend - Restructured

admin/
├── index.html (Template - minimal logic)
├── styles/
│   └── shared.css
│   └── admin.css
├── js/
│   ├── modules/
│   │   ├── state.js
│   │   ├── api.js
│   │   ├── validators.js
│   │   ├── ui-components.js
│   │   └── business-logic.js
│   ├── views/
│   │   ├── form-view.js
│   │   ├── table-view.js
│   │   └── analytics-view.js
│   ├── controllers/
│   │   ├── form-controller.js
│   │   └── table-controller.js
│   └── app.js (Main entry point)

public/
├── view.html (Template - minimal logic)
├── styles/
│   └── shared.css (same as admin)
├── js/
│   ├── modules/
│   │   ├── state.js (read-only)
│   │   ├── api.js (limited endpoints)
│   │   └── ui-components.js
│   ├── views/
│   │   ├── table-view.js
│   │   └── analytics-view.js
│   └── app.js (Minimal)
```

---

## Step-by-Step Refactoring Plan

### Week 1: Foundation Fixes (Low Risk)

```
Day 1-2: Extract Constants & Utilities
├── Create shared/constants.js with BUSINESS_RULES
├── Create shared/validators.js
└── Update index.html & view.html to use them
  Effort: 2-3 hours
  Risk: LOW (backward compatible)

Day 3-4: Extract Shared CSS
├── Create styles/shared.css
├── Remove duplicate CSS from both HTML files
├── Update <link> tags to reference shared file
  Effort: 1-2 hours
  Risk: VERY LOW

Day 5: Add Toast Module
├── Create js/ui-components.js
├── Implement showToast() function
├── Replace all alerts with toasts
  Effort: 2-3 hours
  Risk: LOW
```

### Week 2: Core Refactoring (Medium Risk)

```
Day 1: Extract State Management
├── Create js/modules/state.js with SensusState pattern
├── Update index.html to use new state system
├── Verify admin view still works
  Effort: 3-4 hours
  Risk: MEDIUM (extensive changes)
  Test: Filter all views, save data, edit records

Day 2-3: Extract API Layer
├── Create js/modules/api.js
├── Implement promise-based API calls
├── Add proper error handling
  Effort: 2-3 hours
  Risk: MEDIUM
  Test: Load data, save, verify timeout handling

Day 4: Extract UI Rendering
├── Create js/modules/ui-renderer.js
├── Refactor renderTable, renderChart functions
├── Remove XSS vulnerabilities
  Effort: 2-3 hours
  Risk: MEDIUM
  Test: Table rendering, chart display, large datasets

Day 5: Integration & Testing
├── Update view.html to use new modules
├── Test both admin and public views
├── Fix any conflicts
  Effort: 2-3 hours
  Risk: MEDIUM
```

### Week 3: Complete Extraction (High Risk)

```
Day 1-2: Split admin.js and public.js
├── Create js/admin/main.js (admin-only logic)
├── Create js/public/main.js (public-only logic)
├── Remove duplicate filter logic
  Effort: 3-4 hours
  Risk: HIGH (complex filtering)
  Test: Extensively test both filter behaviors

Day 3: Test Coverage
├── Write unit tests for validators
├── Write integration tests for data flow
├── Load test with 1000+ records
  Effort: 2-3 hours
  Risk: MEDIUM

Day 4-5: Performance Optimization
├── Implement virtual scrolling for large tables
├── Optimize chart rendering
├── Measure performance improvements
  Effort: 2-3 hours
  Risk: MEDIUM (complex DOM manipulation)
```

---

## File Structure After Refactoring

```
bbk02-inventory-sensus/
├── Code.gs                           (No changes)
├── index.html                        (Cleaned up, minimal)
├── view.html                         (Cleaned up, minimal)
├── README.md
├── TECHNICAL_REVIEW.md
├── FIXES_CODE_EXAMPLES.md
├── ARCHITECTURE_REFACTORING.md
│
├── styles/
│   ├── shared.css                    (Extracted from HTML)
│   ├── admin.css                     (Admin-specific styles)
│   └── public.css                    (Public-specific styles)
│
├── js/
│   ├── modules/
│   │   ├── state.js                  (State management)
│   │   ├── api.js                    (API service)
│   │   ├── validators.js             (Input validation)
│   │   ├── ui-components.js          (Reusable UI)
│   │   └── business-logic.js         (Calculations)
│   │
│   ├── admin/
│   │   ├── app.js                    (Admin entry point)
│   │   ├── controllers/
│   │   │   ├── form-controller.js
│   │   │   └── table-controller.js
│   │   └── views/
│   │       ├── form-view.js
│   │       ├── table-view.js
│   │       └── analytics-view.js
│   │
│   └── public/
│       ├── app.js                    (Public entry point)
│       ├── controllers/
│       │   └── view-controller.js
│       └── views/
│           ├── table-view.js
│           └── analytics-view.js
│
└── tests/
    ├── validators.test.js
    ├── state.test.js
    └── api.test.js
```

---

## Performance Benefits After Refactoring

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Initial Load | ~500KB (both files) | ~250KB (split + lazy load) | 50% reduction |
| Time to Interactive | ~2s | ~1s | 50% faster |
| Cache Efficiency | Low (full HTML each time) | High (modules cached separately) | Better |
| Maintainability | Poor (code duplication) | Excellent (single source) | Easy to update |
| Test Coverage | 0% | 70%+ | Testable code |
| XSS Vulnerability | YES | NO | Secure |

---

## Backwards Compatibility Notes

All refactoring should maintain:
- ✅ Same user interface (no visual changes)
- ✅ Same data format (no schema changes)
- ✅ Same API (no endpoint changes)
- ✅ Same URL structure

This means users won't notice any difference during the transition!

---

## Risk Mitigation

1. **Use feature branches** - Keep main in production while refactoring
2. **Write tests first** - Before refactoring, write tests for current behavior
3. **Refactor incrementally** - One module at a time, test after each change
4. **Keep git history** - Use atomic commits, enable easy rollback
5. **Parallel testing** - Run old and new code side-by-side before switching

---

## Success Criteria

- [ ] All tests passing (80%+ coverage)
- [ ] Load time improved by 30%+
- [ ] Zero code duplication between views
- [ ] All CRITICAL issues resolved
- [ ] No visual/functional changes for users
- [ ] Code review approval from team
- [ ] 24-hour monitoring after deployment

