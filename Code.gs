/**
 * Sensus Jamaah Babakan Barat - Google Apps Script Backend
 * File ini menangani server-side logic, interaksi dengan Google Sheets,
 * otomatisasi perhitungan kategori usia, rekapitulasi data, dan akses PIN.
 *
 * KEAMANAN (WAJIB DIBACA):
 * - Semua fungsi yang TIDAK berakhiran "_" bisa dipanggil dari browser lewat
 *   google.script.run. Karena itu setiap fungsi publik di bawah memeriksa token sesi.
 * - PIN disimpan di Script Properties (Project Settings -> Script Properties):
 *     ADMIN_PIN  : PIN untuk halaman editor (tambah/edit/hapus data, pengaturan kategori)
 *     VIEWER_PIN : PIN untuk halaman ringkasan (?page=view)
 *   Gunakan minimal 6 digit dan jangan dibagikan di grup umum.
 */

var CONFIG = {
  SHEET_KELUARGA: "Keluarga",
  SHEET_JAMAAH: "Jamaah",
  SHEET_SUMBER_MIGRASI: "Sensus_Asal",
  SHEET_PENGATURAN: "Pengaturan_Kategori",
  SHEET_PENGATURAN_KEBERADAAN: "Pengaturan_Keberadaan",
  SHEET_ARSIP_JAMAAH: "Arsip_Jamaah",
  SHEET_ARSIP_KELUARGA: "Arsip_Keluarga",
  FALLBACK_URL: "", // Masukkan URL Google Spreadsheet Anda di sini jika dijalankan di luar konteks container

  // Sesi login (detik). Maksimum CacheService = 21600 (6 jam).
  SESSION_TTL_SEC: 21600,
  // Proteksi tebak PIN: setelah MAX_FAIL kali salah, login dikunci LOCK_SEC detik.
  MAX_FAIL: 5,
  LOCK_SEC: 900,
  MIN_PIN_LENGTH: 6,

  // true hanya jika aplikasi di-embed di situs lain (mis. Google Sites).
  ALLOW_EMBED: false,

  // Dipakai hanya bila tidak ada kategori yang diberi penanda LANSIA di Pengaturan_Kategori.
  BATAS_LANSIA: 57
};

var ROLE = { ADMIN: "ADMIN", VIEWER: "VIEWER" };

var ENUM = {
  HUBUNGAN: ["A", "B", "C", "D"],
  JK: ["L", "P"],
  STATUS_NIKAH: ["BELUM", "MENIKAH", "DUDA", "JANDA"],
  YN: ["Y", "N"],
  // Pilihan bawaan; daftar yang berlaku diatur di sheet Pengaturan_Keberadaan (menu Pengaturan)
  KEBERADAAN: ["Menetap", "Mondok", "Tugas", "Kerja Luar"]
};

/* ======================================================================
 * WEB APP ENTRY POINT
 * ====================================================================== */

function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) || 'index';
  var file = page === 'view' ? 'view' : 'index';
  var title = page === 'view'
    ? 'Sensus Jiwa Kelompok Babakan Barat - Ringkasan'
    : 'Sensus Jiwa Kelompok Babakan Barat';

  var out = HtmlService.createHtmlOutputFromFile(file)
    .setTitle(title)
    // maximum-scale=1: cegah iOS auto-zoom saat fokus input di dalam iframe Apps Script.
    // iOS 10+ tetap mengizinkan pinch-zoom manual.
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1');
  if (CONFIG.ALLOW_EMBED) {
    out.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return out;
}

/**
 * JSON API untuk frontend di luar Apps Script (mis. GitHub Pages).
 * Body (text/plain): {"action": "login" | "logout" | "getSensusData" | "saveSensusData" |
 *                    "deleteJamaah" | "deleteKeluarga" | "getArsipJamaah" | "restoreJamaah" | "saveKategoriConfig" | "saveKeberadaanConfig", "args": [...]}
 * Hanya aksi di daftar ini yang bisa dipanggil; migrasi & fungsi internal tidak terekspos.
 * Keamanan tetap sama: setiap aksi (kecuali login) memeriksa token sesi dari PIN.
 */
var API_ACTIONS = {
  login: function (args) { return login(args[0], args[1]); },
  logout: function (args) { return logout(args[0]); },
  getSensusData: function (args) { return getSensusData(args[0]); },
  saveSensusData: function (args) { return saveSensusData(args[0], args[1]); },
  deleteJamaah: function (args) { return deleteJamaah(args[0], args[1], args[2], args[3]); },
  deleteKeluarga: function (args) { return deleteKeluarga(args[0], args[1], args[2]); },
  getArsipJamaah: function (args) { return getArsipJamaah(args[0]); },
  restoreJamaah: function (args) { return restoreJamaah(args[0], args[1], args[2]); },
  saveKategoriConfig: function (args) { return saveKategoriConfig(args[0], args[1]); },
  saveKeberadaanConfig: function (args) { return saveKeberadaanConfig(args[0], args[1]); }
};

function doPost(e) {
  var result;
  try {
    var body = (e && e.postData && e.postData.contents) || '';
    if (body.length > 50000) throw new Error("Permintaan terlalu besar.");
    var req = JSON.parse(body || '{}');
    var action = String(req.action || '');
    if (!Object.prototype.hasOwnProperty.call(API_ACTIONS, action)) {
      throw new Error("Aksi tidak dikenal.");
    }
    result = API_ACTIONS[action](Array.isArray(req.args) ? req.args : []);
  } catch (err) {
    result = { success: false, message: "Permintaan tidak valid: " + err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ======================================================================
 * AUTENTIKASI PIN
 * ====================================================================== */

/**
 * Login dengan PIN.
 * @param {string} pin
 * @param {string} page 'index' (admin) atau 'view' (ringkasan)
 * @return {{success:boolean, token?:string, role?:string, message?:string}}
 */
function login(pin, page) {
  try {
    var cache = CacheService.getScriptCache();
    var lockKey = 'login_lock';
    var failKey = 'login_fail';

    if (cache.get(lockKey)) {
      return { success: false, message: "Terlalu banyak percobaan PIN salah. Coba lagi dalam " + Math.round(CONFIG.LOCK_SEC / 60) + " menit." };
    }

    var props = PropertiesService.getScriptProperties();
    // trim: nilai yang di-paste ke Script Properties sering membawa spasi / baris baru
    var adminPin = String(props.getProperty('ADMIN_PIN') || '').trim();
    var viewerPin = String(props.getProperty('VIEWER_PIN') || '').trim();
    if (adminPin.length < CONFIG.MIN_PIN_LENGTH) {
      return { success: false, message: "ADMIN_PIN belum diatur (minimal " + CONFIG.MIN_PIN_LENGTH + " digit) di Script Properties. Hubungi pengelola aplikasi." };
    }

    var input = String(pin || '').trim();
    var role = null;
    if (input && safeEquals_(input, adminPin)) {
      role = ROLE.ADMIN;
    } else if (page === 'view' && viewerPin.length >= CONFIG.MIN_PIN_LENGTH && input && safeEquals_(input, viewerPin)) {
      role = ROLE.VIEWER;
    }

    if (!role && input && viewerPin.length >= CONFIG.MIN_PIN_LENGTH && safeEquals_(input, viewerPin)) {
      // PIN viewer benar, tapi dibuka di halaman admin: beri arahan, jangan dihitung salah
      return { success: false, message: "Ini PIN viewer (hanya-lihat). Buka halaman Ringkasan: alamat web app ditambah ?page=view" };
    }
    if (!role && page === 'view' && viewerPin.length < CONFIG.MIN_PIN_LENGTH && !safeEquals_(input, adminPin)) {
      return { success: false, message: "VIEWER_PIN belum diatur atau kurang dari " + CONFIG.MIN_PIN_LENGTH + " karakter di Script Properties. Hubungi pengelola aplikasi." };
    }

    if (!role) {
      var fails = Number(cache.get(failKey) || 0) + 1;
      if (fails >= CONFIG.MAX_FAIL) {
        cache.put(lockKey, '1', CONFIG.LOCK_SEC);
        cache.remove(failKey);
      } else {
        cache.put(failKey, String(fails), CONFIG.LOCK_SEC);
      }
      Utilities.sleep(800); // perlambat tebakan beruntun
      return { success: false, message: "PIN salah." };
    }

    cache.remove(failKey);
    var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    cache.put('sess_' + token, JSON.stringify({ role: role, at: new Date().getTime() }), CONFIG.SESSION_TTL_SEC);
    return { success: true, token: token, role: role };
  } catch (err) {
    return { success: false, message: "Login gagal: " + err.message };
  }
}

function logout(token) {
  if (token) CacheService.getScriptCache().remove('sess_' + token);
  return { success: true };
}

/** Cek sesi; perpanjang masa aktif (sliding). Lempar AuthError jika tidak valid. */
function requireSession_(token, allowedRoles) {
  if (!token || typeof token !== 'string') throw authError_("Silakan masuk dengan PIN.");
  var cache = CacheService.getScriptCache();
  var raw = cache.get('sess_' + token);
  if (!raw) throw authError_("Sesi berakhir. Silakan masuk kembali.");
  var sess = JSON.parse(raw);
  if (allowedRoles.indexOf(sess.role) === -1) throw authError_("PIN Anda tidak punya akses untuk aksi ini.");
  cache.put('sess_' + token, raw, CONFIG.SESSION_TTL_SEC);
  return sess;
}

function authError_(msg) {
  var e = new Error(msg);
  e.isAuth = true;
  return e;
}

function errorResponse_(err, prefix) {
  return {
    success: false,
    authError: !!(err && err.isAuth),
    message: (prefix || "") + (err && err.message ? err.message : String(err)),
    data: null
  };
}

/** Perbandingan string dengan waktu konstan (mengurangi timing attack). */
function safeEquals_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Hanya boleh dijalankan pemilik dari Apps Script Editor (bukan dari browser web app).
 * Saat dipanggil via web app oleh pengunjung, getActiveUser() kosong / berbeda dari pemilik.
 */
function assertEditorRun_() {
  var active = Session.getActiveUser().getEmail();
  var owner = Session.getEffectiveUser().getEmail();
  if (!active || active !== owner) {
    throw new Error("Fungsi ini hanya boleh dijalankan pemilik dari Apps Script Editor.");
  }
}

/* ======================================================================
 * UTILITAS SPREADSHEET
 * ====================================================================== */

var HEADER_KELUARGA = ["ID Keluarga", "Nama KK", "Alamat", "No Telepon"];
var HEADER_JAMAAH = [
  "ID Jamaah", "ID Keluarga", "Hubungan Keluarga", "Nama Lengkap",
  "Nama Absen", "Jenis Kelamin", "Tahun Lahir", "Status Nikah",
  "Status Keaktifan", "Flag Absen", "Status Keberadaan", "Catatan",
  "No Telepon", "Perlu Dibantu"
];
var JAMAAH_CORE_COLS = 12; // kolom A–L selalu berurutan seperti HEADER_JAMAAH
// Jamaah mandiri / perantau: kolom "ID Keluarga" dikosongkan; tidak dihitung sebagai KK
var LABEL_TANPA_KK = "Tanpa KK (mandiri/perantau)";
var LABEL_KK_HILANG = "KK tidak ditemukan";
var HEADER_KATEGORI = ["Urutan", "Nama Kategori", "Umur Min", "Umur Maks", "Penanda"];

function getSpreadsheet_() {
  var ss = null;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {}

  if (!ss && CONFIG.FALLBACK_URL) {
    try {
      ss = SpreadsheetApp.openByUrl(CONFIG.FALLBACK_URL);
    } catch (err) {
      Logger.log("Gagal membuka spreadsheet melalui fallback URL: " + err.toString());
    }
  }
  if (!ss) throw new Error("Spreadsheet tidak ditemukan!");
  return ss;
}

/**
 * Membuat sheet Keluarga & Jamaah dengan header standar jika belum ada.
 * Kolom tambahan (No Telepon, Perlu Dibantu) dicari BERDASARKAN NAMA HEADER.
 * Bila belum ada, ditambahkan di kolom kosong pertama setelah header terakhir,
 * sehingga kolom milik pengguna (mis. "Umur" di kolom M) tidak pernah ditimpa.
 */
function initializeSheets_(ss) {
  var keluargaSheet = ss.getSheetByName(CONFIG.SHEET_KELUARGA);
  if (!keluargaSheet) {
    keluargaSheet = ss.insertSheet(CONFIG.SHEET_KELUARGA);
    keluargaSheet.appendRow(HEADER_KELUARGA);
  }

  var jamaahSheet = ss.getSheetByName(CONFIG.SHEET_JAMAAH);
  if (!jamaahSheet) {
    jamaahSheet = ss.insertSheet(CONFIG.SHEET_JAMAAH);
    jamaahSheet.appendRow(HEADER_JAMAAH);
  }
  return { keluarga: keluargaSheet, jamaah: jamaahSheet, jamaahCols: jamaahExtraCols_(jamaahSheet) };
}

/** Posisi kolom (1-based) No Telepon & Perlu Dibantu di sheet Jamaah; dibuat bila belum ada. */
function jamaahExtraCols_(sheet) {
  var width = Math.max(sheet.getLastColumn(), JAMAAH_CORE_COLS);
  var header = sheet.getRange(1, 1, 1, width).getValues()[0];
  var norm = header.map(function (h) { return String(h == null ? '' : h).trim().toLowerCase(); });
  var lastFilled = JAMAAH_CORE_COLS;
  for (var i = norm.length - 1; i >= 0; i--) { if (norm[i]) { lastFilled = Math.max(lastFilled, i + 1); break; } }

  function find(name) {
    for (var c = JAMAAH_CORE_COLS; c < norm.length; c++) if (norm[c] === name.toLowerCase()) return c + 1;
    return 0;
  }
  var tel = find(HEADER_JAMAAH[12]);
  var bantu = find(HEADER_JAMAAH[13]);
  if (!tel) { tel = ++lastFilled; sheet.getRange(1, tel, 1, 1).setValues([[HEADER_JAMAAH[12]]]); }
  if (!bantu) { bantu = ++lastFilled; sheet.getRange(1, bantu, 1, 1).setValues([[HEADER_JAMAAH[13]]]); }
  return { telepon: tel, dibantu: bantu, width: Math.max(width, tel, bantu) };
}

/**
 * Baris data terakhir berdasarkan kolom A (ID). getLastRow() bisa jauh lebih besar
 * bila ada kolom rumus yang di-copy sampai bawah, sehingga baris baru salah tempat.
 */
function lastDataRow_(sheet) {
  var last = sheet.getLastRow();
  if (last < 2) return 1;
  var ids = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]).trim() !== '') return i + 2;
  return 1;
}

/**
 * Menulis satu baris sebagai teks biasa ("@") supaya:
 * - No. telepon "0812..." tidak berubah jadi angka 812...
 * - Input yang diawali "=" tidak dieksekusi sebagai rumus (formula injection).
 * Kolom pada numericCols (0-based) tetap berformat angka.
 */
function writeRowAsText_(sheet, rowIndex, values, numericCols) {
  var formats = values.map(function (_, idx) {
    return (numericCols && numericCols.indexOf(idx) !== -1) ? '0' : '@';
  });
  sheet.getRange(rowIndex, 1, 1, values.length)
    .setNumberFormats([formats])
    .setValues([values]);
}

function newId_(prefix) {
  return prefix + "-" + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

/* ======================================================================
 * KONFIGURASI KATEGORI USIA
 * Disimpan di sheet "Pengaturan_Kategori" (bisa diubah dari halaman admin
 * atau langsung di sheet). Aturan, berurutan:
 *  1. Umur masuk rentang kategori bertanda LANSIA -> kategori Lansia, APA PUN status nikahnya.
 *  2. Status MENIKAH -> kategori "label menikah" (default "Dewasa Menikah").
 *  3. Status DUDA / JANDA -> dihitung di kolom Duda / Janda tersendiri.
 *  4. Belum menikah -> dicocokkan ke rentang umur di tabel (urut dari umur kecil).
 *  Umur minimal kategori LANSIA juga dipakai untuk kartu "Lansia" di dashboard.
 * ====================================================================== */

var DEFAULT_KATEGORI = {
  kategori: [
    { nama: "BALITA-PAUD", min: 0, max: 5, lansia: false },
    { nama: "Caberawit", min: 6, max: 12, lansia: false },
    { nama: "Pra Remaja (SMP)", min: 13, max: 15, lansia: false },
    { nama: "Remaja (SMA)", min: 16, max: 17, lansia: false },
    { nama: "Usia (Pra) Menikah", min: 18, max: 56, lansia: false },
    { nama: "Lansia", min: 57, max: null, lansia: true }
  ],
  labelMenikah: "Dewasa Menikah"
};

function cloneConfig_(cfg) { return JSON.parse(JSON.stringify(cfg)); }

/** Baca konfigurasi dari sheet; bila belum ada, buat sheet berisi nilai default. */
function getKategoriConfig_(ss) {
  var sh = ss.getSheetByName(CONFIG.SHEET_PENGATURAN);
  if (!sh) {
    writeKategoriSheet_(ss, DEFAULT_KATEGORI);
    return cloneConfig_(DEFAULT_KATEGORI);
  }
  var last = sh.getLastRow();
  if (last < 2) return cloneConfig_(DEFAULT_KATEGORI);
  var rows = sh.getRange(2, 1, last - 1, 5).getValues();
  var cfg = { kategori: [], labelMenikah: DEFAULT_KATEGORI.labelMenikah };
  rows.forEach(function (r) {
    var nama = String(r[1] || '').trim();
    var penanda = String(r[4] || '').trim().toUpperCase();
    if (!nama) return;
    if (penanda === 'MENIKAH') { cfg.labelMenikah = nama; return; }
    cfg.kategori.push({
      nama: nama,
      min: r[2] === '' || r[2] === null ? 0 : Number(r[2]),
      max: r[3] === '' || r[3] === null ? null : Number(r[3]),
      lansia: penanda === 'LANSIA'
    });
  });
  try {
    return validateKategoriConfig_(cfg);
  } catch (e) {
    Logger.log("Pengaturan_Kategori tidak valid, memakai default: " + e.message);
    var def = cloneConfig_(DEFAULT_KATEGORI);
    def.invalid = e.message;
    return def;
  }
}

function writeKategoriSheet_(ss, cfg) {
  var sh = ss.getSheetByName(CONFIG.SHEET_PENGATURAN) || ss.insertSheet(CONFIG.SHEET_PENGATURAN);
  var last = sh.getLastRow();
  if (last > 0) sh.getRange(1, 1, last, 5).clearContent();
  var rows = [HEADER_KATEGORI];
  cfg.kategori.forEach(function (k, i) {
    rows.push([i + 1, k.nama, k.min, k.max === null ? "" : k.max, k.lansia ? "LANSIA" : ""]);
  });
  rows.push([cfg.kategori.length + 1, cfg.labelMenikah, "", "", "MENIKAH"]);
  var range = sh.getRange(1, 1, rows.length, 5);
  range.setNumberFormat('@');
  sh.getRange(2, 1, rows.length - 1, 1).setNumberFormat('0');
  sh.getRange(2, 3, rows.length - 1, 2).setNumberFormat('0');
  range.setValues(rows);
}

/** Validasi & normalisasi konfigurasi. Lempar Error berisi pesan ramah pengguna. */
function validateKategoriConfig_(input) {
  if (!input || !Array.isArray(input.kategori)) throw new Error("Format pengaturan kategori tidak valid.");
  var label = String(input.labelMenikah || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!label) throw new Error("Nama kategori untuk yang sudah menikah wajib diisi.");
  if (input.kategori.length < 1 || input.kategori.length > 12) throw new Error("Jumlah kategori umur harus 1 sampai 12.");

  var reserved = { 'DUDA': 1, 'JANDA': 1, 'TANPA TAHUN LAHIR': 1, 'DI LUAR KATEGORI': 1 };
  var seen = {};
  seen[label.toUpperCase()] = 1;
  if (reserved[label.toUpperCase()]) throw new Error("Nama '" + label + "' dipakai sistem, gunakan nama lain.");

  var list = input.kategori.map(function (k, i) {
    var nama = String(k.nama || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    var no = "Baris " + (i + 1) + ": ";
    if (!nama) throw new Error(no + "nama kategori wajib diisi.");
    if (reserved[nama.toUpperCase()]) throw new Error(no + "nama '" + nama + "' dipakai sistem.");
    if (seen[nama.toUpperCase()]) throw new Error(no + "nama '" + nama + "' dipakai lebih dari sekali.");
    seen[nama.toUpperCase()] = 1;
    var min = Number(k.min);
    var max = (k.max === null || k.max === undefined || k.max === '') ? null : Number(k.max);
    if (!(Math.floor(min) === min && min >= 0 && min <= 150)) throw new Error(no + "umur minimal harus angka bulat 0–150.");
    if (max !== null && !(Math.floor(max) === max && max >= min && max <= 150)) throw new Error(no + "umur maksimal harus angka bulat ≥ umur minimal.");
    return { nama: nama, min: min, max: max, lansia: k.lansia === true || k.lansia === 'true' };
  });

  list.sort(function (a, b) { return a.min - b.min; });
  if (list[0].min !== 0) throw new Error("Kategori pertama harus mulai dari umur 0.");
  for (var i = 1; i < list.length; i++) {
    var prev = list[i - 1], cur = list[i];
    if (prev.max === null) throw new Error("Hanya kategori dengan umur terbesar yang boleh tanpa batas atas ('" + prev.nama + "').");
    if (cur.min !== prev.max + 1) {
      throw new Error("Rentang umur harus bersambung: '" + prev.nama + "' sampai " + prev.max +
        " th, maka '" + cur.nama + "' harus mulai " + (prev.max + 1) + " th.");
    }
  }
  if (list[list.length - 1].max !== null) throw new Error("Kategori terakhir ('" + list[list.length - 1].nama + "') harus tanpa batas atas (kosongkan umur maksimal).");
  var lansiaCount = list.filter(function (k) { return k.lansia; }).length;
  if (lansiaCount > 1) throw new Error("Penanda Lansia hanya boleh di satu kategori.");

  return { kategori: list, labelMenikah: label };
}

function lansiaKategori_(cfg) {
  for (var i = 0; i < cfg.kategori.length; i++) if (cfg.kategori[i].lansia) return cfg.kategori[i];
  return null;
}

function lansiaMin_(cfg) {
  for (var i = 0; i < cfg.kategori.length; i++) if (cfg.kategori[i].lansia) return cfg.kategori[i].min;
  return CONFIG.BATAS_LANSIA;
}

/* ======================================================================
 * PILIHAN STATUS KEBERADAAN
 * Disimpan di sheet "Pengaturan_Keberadaan" (kolom A Urutan, B Nama).
 * "Menetap" wajib ada dan selalu di urutan pertama (nilai bawaan).
 * ====================================================================== */

var KEBERADAAN_DEFAULT_VALUE = "Menetap";

function getKeberadaanList_(ss) {
  var sh = ss.getSheetByName(CONFIG.SHEET_PENGATURAN_KEBERADAAN);
  if (!sh) {
    writeKeberadaanSheet_(ss, ENUM.KEBERADAAN);
    return ENUM.KEBERADAAN.slice();
  }
  var last = sh.getLastRow();
  var raw = last > 1 ? sh.getRange(2, 2, last - 1, 1).getValues().map(function (r) { return r[0]; }) : [];
  try {
    return validateKeberadaanList_(raw);
  } catch (e) {
    Logger.log("Pengaturan_Keberadaan tidak valid, memakai bawaan: " + e.message);
    return ENUM.KEBERADAAN.slice();
  }
}

function writeKeberadaanSheet_(ss, list) {
  var sh = ss.getSheetByName(CONFIG.SHEET_PENGATURAN_KEBERADAAN) || ss.insertSheet(CONFIG.SHEET_PENGATURAN_KEBERADAAN);
  var last = sh.getLastRow();
  if (last > 0) sh.getRange(1, 1, last, 2).clearContent();
  var rows = [["Urutan", "Status Keberadaan"]].concat(list.map(function (v, i) { return [i + 1, v]; }));
  var range = sh.getRange(1, 1, rows.length, 2);
  range.setNumberFormat('@');
  sh.getRange(2, 1, rows.length - 1, 1).setNumberFormat('0');
  range.setValues(rows);
}

/** Validasi & normalisasi daftar keberadaan. "Menetap" dipastikan ada di urutan pertama. */
function validateKeberadaanList_(input) {
  if (!Array.isArray(input)) throw new Error("Format pilihan keberadaan tidak valid.");
  var seen = {};
  var list = [];
  input.forEach(function (v) {
    var name = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    if (!name) return;
    if (name.length > 30) throw new Error("Nama '" + name.slice(0, 30) + "…' terlalu panjang (maks. 30 karakter).");
    if (/^[=+\-@]/.test(name)) throw new Error("Nama '" + name + "' tidak boleh diawali tanda = + - @.");
    var key = name.toUpperCase();
    if (seen[key]) throw new Error("Pilihan '" + name + "' dipakai lebih dari sekali.");
    seen[key] = 1;
    list.push(key === KEBERADAAN_DEFAULT_VALUE.toUpperCase() ? KEBERADAAN_DEFAULT_VALUE : name);
  });
  if (list.length > 20) throw new Error("Maksimal 20 pilihan keberadaan.");
  var idx = list.indexOf(KEBERADAAN_DEFAULT_VALUE);
  if (idx === -1) list.unshift(KEBERADAAN_DEFAULT_VALUE);
  else if (idx > 0) { list.splice(idx, 1); list.unshift(KEBERADAAN_DEFAULT_VALUE); }
  return list;
}

/** Cocokkan nilai sheet ke pilihan resmi (tidak peka huruf besar/kecil). Kosong = Menetap. */
function matchKeberadaan_(value, list) {
  var v = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  if (!v) return { value: KEBERADAAN_DEFAULT_VALUE, known: true };
  for (var i = 0; i < list.length; i++) if (list[i].toUpperCase() === v.toUpperCase()) return { value: list[i], known: true };
  return { value: v, known: false };
}

/* ======================================================================
 * RULE ENGINE
 * ====================================================================== */

/**
 * Menentukan Kategori Usia secara dinamis.
 * @param {number} tahunLahir
 * @param {string} statusNikah
 * @param {object=} cfg konfigurasi kategori (default bila kosong)
 * @return {string} Kategori Usia
 */
function dapatkanKategoriUsia(tahunLahir, statusNikah, cfg) {
  cfg = cfg || DEFAULT_KATEGORI;
  var status = (statusNikah || "").toUpperCase().trim();
  var umur = tahunLahir ? new Date().getFullYear() - tahunLahir : null;

  // 1. Lansia diutamakan di atas status nikah
  var lansia = lansiaKategori_(cfg);
  if (lansia && umur !== null && umur >= lansia.min && (lansia.max === null || umur <= lansia.max)) {
    return lansia.nama;
  }
  // 2–3. Sudah (pernah) menikah
  if (status === "MENIKAH" || status === "DUDA" || status === "JANDA") {
    return cfg.labelMenikah;
  }
  if (umur === null) return "Tanpa Tahun Lahir";

  // 4. Belum menikah: rentang umur
  for (var i = 0; i < cfg.kategori.length; i++) {
    var k = cfg.kategori[i];
    if (umur >= k.min && (k.max === null || umur <= k.max)) return k.nama;
  }
  return "Di Luar Kategori";
}

/* ======================================================================
 * BACA DATA
 * ====================================================================== */

/**
 * Mengambil data sensus + rekap.
 * ADMIN  : seluruh data (termasuk alamat, telepon, catatan, perlu dibantu) + konfigurasi kategori.
 * VIEWER : seluruh jamaah (hanya-lihat), tanpa penanda Perlu dibantu dan ID asli.
 * @param {string} token
 */
function getSensusData(token) {
  try {
    var sess = requireSession_(token, [ROLE.ADMIN, ROLE.VIEWER]);
    var full = readSensus_();
    if (sess.role === ROLE.ADMIN) {
      return { success: true, role: sess.role, data: full };
    }
    return { success: true, role: sess.role, data: toPublicData_(full) };
  } catch (err) {
    return errorResponse_(err);
  }
}

function readSensus_() {
  var ss = getSpreadsheet_();
  var sheets = initializeSheets_(ss);
  var cfg = getKategoriConfig_(ss);
  var keberadaanList = getKeberadaanList_(ss);
  var keberadaanTakDikenal = {};
  var batasLansia = lansiaMin_(cfg);
  var lansiaKat = lansiaKategori_(cfg);
  var shKeluarga = sheets.keluarga;
  var shJamaah = sheets.jamaah;
  var cols = sheets.jamaahCols;
  var warnings = [];
  var teleponTidakValid = 0;

  // 1. Data keluarga
  var keluargaList = [];
  var keluargaMap = {};
  var lastRowKeluarga = shKeluarga.getLastRow();
  if (lastRowKeluarga > 1) {
    var valKeluarga = shKeluarga.getRange(2, 1, lastRowKeluarga - 1, 4).getValues();
    for (var i = 0; i < valKeluarga.length; i++) {
      var kRow = valKeluarga[i];
      if (!kRow[0]) continue;
      var kObj = {
        id_keluarga: String(kRow[0]),
        nama_kk: String(kRow[1]),
        alamat: String(kRow[2]),
        telepon: String(kRow[3])
      };
      keluargaList.push(kObj);
      keluargaMap[kObj.id_keluarga] = kObj.nama_kk;
    }
  }

  // 2. Data jamaah + rekap
  var kategoriOrder = cfg.kategori.map(function (k) { return k.nama; }).concat([cfg.labelMenikah]);
  var detail = {};
  kategoriOrder.forEach(function (k) { detail[k] = { L: 0, P: 0 }; });
  var rekap = {
    total: 0, laki: 0, perempuan: 0, duda: 0, janda: 0,
    lansia: 0, batasLansia: batasLansia, kkCount: 0,
    tanpaTahunLahir: 0, diLuarKategori: 0, perluDibantu: 0,
    kategoriOrder: kategoriOrder,
    detail: detail
  };
  var jamaahList = [];
  var inactiveKeluargaIds = {};
  var tahunSekarang = new Date().getFullYear();

  var lastRowJamaah = shJamaah.getLastRow();
  if (lastRowJamaah > 1) {
    var valJamaah = shJamaah.getRange(2, 1, lastRowJamaah - 1, cols.width).getValues();

    for (var j = 0; j < valJamaah.length; j++) {
      var jRow = valJamaah[j];
      if (!jRow[0]) continue;

      var idKeluarga = String(jRow[1]);
      var hubKeluarga = String(jRow[2]).toUpperCase();
      var jk = String(jRow[5]).toUpperCase();
      var tahunLahir = Number(jRow[6]);
      if (!(tahunLahir >= 1900 && tahunLahir <= tahunSekarang)) tahunLahir = null; // tidak lagi diam-diam jadi "tahun ini"
      var statusNikah = String(jRow[7]).toUpperCase();
      var isAktif = String(jRow[8]).toUpperCase() === "N" ? "N" : "Y";
      var flagAbsen = String(jRow[9]).toUpperCase() === "N" ? "N" : "Y";
      var perluDibantu = String(jRow[cols.dibantu - 1]).toUpperCase() === "Y" ? "Y" : "N";
      // Nomor telepon wajar punya minimal 6 angka. Nilai seperti "70" (mis. umur) tidak ditampilkan.
      var telRaw = jRow[cols.telepon - 1];
      var telepon = String(telRaw == null ? '' : telRaw).trim();
      if (telepon && !(/^[0-9+\-\s().]{6,20}$/.test(telepon) && telepon.replace(/\D/g, '').length >= 6)) {
        teleponTidakValid++;
        telepon = '';
      }

      if (hubKeluarga === "A" && isAktif === "N") {
        inactiveKeluargaIds[idKeluarga] = true;
      }

      var umur = tahunLahir ? tahunSekarang - tahunLahir : null;
      var kategoriUsia = dapatkanKategoriUsia(tahunLahir, statusNikah, cfg);
      var keberadaan = matchKeberadaan_(jRow[10], keberadaanList);
      if (!keberadaan.known) keberadaanTakDikenal[keberadaan.value] = (keberadaanTakDikenal[keberadaan.value] || 0) + 1;

      jamaahList.push({
        id_jamaah: String(jRow[0]),
        id_keluarga: idKeluarga,
        nama_kk: !idKeluarga ? LABEL_TANPA_KK : (keluargaMap[idKeluarga] || LABEL_KK_HILANG),
        tanpa_kk: !idKeluarga,
        hubungan_keluarga: hubKeluarga,
        nama_lengkap: String(jRow[3]),
        nama_absen: String(jRow[4]),
        jenis_kelamin: jk,
        tahun_lahir: tahunLahir,
        umur: umur,
        status_nikah: statusNikah,
        is_aktif: isAktif,
        flag_absen: flagAbsen,
        status_keberadaan: keberadaan.value,
        kategori_usia: kategoriUsia,
        catatan: String(jRow[11]),
        no_telepon: telepon,
        perlu_dibantu: perluDibantu
      });

      if (perluDibantu === "Y") rekap.perluDibantu++;

      // Agregasi rekap (hanya jamaah aktif wilayah)
      if (isAktif === "Y") {
        rekap.total++;
        if (jk === "L") rekap.laki++;
        else if (jk === "P") rekap.perempuan++;

        // Tiap jiwa dihitung sekali: Duda/Janda yang sudah masuk Lansia dihitung di baris Lansia
        var isLansiaKat = !!(lansiaKat && kategoriUsia === lansiaKat.nama);
        var hitungDudaJanda = !isLansiaKat && (statusNikah === "DUDA" || statusNikah === "JANDA");
        if (hitungDudaJanda && statusNikah === "DUDA") rekap.duda++;
        else if (hitungDudaJanda && statusNikah === "JANDA") rekap.janda++;

        if (umur !== null && umur >= batasLansia) rekap.lansia++;
        if (!tahunLahir) rekap.tanpaTahunLahir++;
        if (kategoriUsia === "Di Luar Kategori") rekap.diLuarKategori++;

        if (rekap.detail[kategoriUsia] && (jk === "L" || jk === "P") && !hitungDudaJanda) {
          rekap.detail[kategoriUsia][jk]++;
        }
      }
    }
  }

  var activeKkCount = 0;
  for (var k = 0; k < keluargaList.length; k++) {
    if (!inactiveKeluargaIds[keluargaList[k].id_keluarga]) activeKkCount++;
  }
  rekap.kkCount = activeKkCount;

  if (teleponTidakValid > 0) {
    warnings.push(teleponTidakValid + " isian di kolom '" + HEADER_JAMAAH[12] + "' (kolom " + columnLetter_(cols.telepon) +
      " sheet Jamaah) bukan nomor telepon, misalnya angka umur. Nilai itu tidak ditampilkan. " +
      "Bila kolom tersebut sebenarnya kolom lain (mis. Umur), ganti header-nya kembali; aplikasi akan membuat kolom '" +
      HEADER_JAMAAH[12] + "' baru di kolom kosong berikutnya.");
  }

  var takDikenal = Object.keys(keberadaanTakDikenal);
  if (takDikenal.length) {
    warnings.push("Status Keberadaan berikut belum ada di Pengaturan: " +
      takDikenal.map(function (k) { return "'" + k + "' (" + keberadaanTakDikenal[k] + " jamaah)"; }).join(", ") +
      ". Data tetap ditampilkan; tambahkan di menu Pengaturan supaya bisa dipilih di form.");
  }

  return { jamaah: jamaahList, keluarga: keluargaList, rekap: rekap, kategoriConfig: cfg,
           keberadaanOptions: keberadaanList, warnings: warnings };
}

function columnLetter_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/**
 * Data untuk halaman ringkasan pengurus (hanya-lihat):
 * seluruh jamaah seperti di halaman admin, KECUALI penanda & jumlah "Perlu dibantu" (khusus admin)
 * dan ID asli (diganti nomor urut keluarga untuk pengelompokan).
 */
function toPublicData_(full) {
  var kk = {};
  full.keluarga.forEach(function (k) { kk[k.id_keluarga] = k; });
  var grup = {}, next = 1;
  var jamaah = full.jamaah.map(function (j) {
    var k = kk[j.id_keluarga];
    if (j.id_keluarga && !grup[j.id_keluarga]) grup[j.id_keluarga] = next++;
    return {
      nama_lengkap: j.nama_lengkap,
      nama_absen: j.nama_absen,
      hubungan_keluarga: j.hubungan_keluarga,
      nama_kk: j.nama_kk,
      grup_kk: grup[j.id_keluarga] || 0, // nomor urut keluarga, bukan ID asli; 0 = tanpa KK
      kk_terdaftar: !!k,
      alamat_kk: k ? k.alamat : '',
      telepon_kk: k ? k.telepon : '',
      jenis_kelamin: j.jenis_kelamin,
      tahun_lahir: j.tahun_lahir,
      umur: j.umur,
      status_nikah: j.status_nikah,
      kategori_usia: j.kategori_usia,
      no_telepon: j.no_telepon,
      is_aktif: j.is_aktif,
      flag_absen: j.flag_absen,
      status_keberadaan: j.status_keberadaan,
      catatan: j.catatan
    };
  });
  var rekap = JSON.parse(JSON.stringify(full.rekap));
  delete rekap.perluDibantu;
  return { jamaah: jamaah, keluarga: [], rekap: rekap, keberadaanOptions: full.keberadaanOptions };
}

/* ======================================================================
 * SIMPAN DATA
 * ====================================================================== */

/**
 * Menambah / mengedit jamaah (opsional sekaligus membuat KK baru). Khusus ADMIN.
 * @param {string} token
 * @param {object} formData
 */
function saveSensusData(token, formData) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    requireSession_(token, [ROLE.ADMIN]);
    var d = validateFormData_(formData, getKeberadaanList_(getSpreadsheet_()));

    locked = lock.tryLock(15000);
    if (!locked) throw new Error("Server sedang sibuk menyimpan data lain. Coba lagi sebentar.");

    var ss = getSpreadsheet_();
    var sheets = initializeSheets_(ss);
    var shKeluarga = sheets.keluarga;
    var shJamaah = sheets.jamaah;

    // Validasi KK yang dipilih benar-benar ada (kecuali jamaah mandiri / tanpa KK)
    var idKeluarga = d.id_keluarga;
    if (!d.is_new_keluarga && !d.tanpa_kk) {
      if (!findRowById_(shKeluarga, idKeluarga)) {
        throw new Error("Keluarga (KK) yang dipilih tidak ditemukan. Pilih ulang dari daftar.");
      }
    }

    // Cari baris jamaah lebih dulu (sebelum menulis apa pun) agar tidak ada KK yatim jika edit gagal
    var foundRowIndex = null;
    if (d.id_jamaah) {
      foundRowIndex = findRowById_(shJamaah, d.id_jamaah);
      if (!foundRowIndex) throw new Error("Data Jamaah dengan ID " + d.id_jamaah + " tidak ditemukan.");
    }

    // 1. KK baru
    if (d.is_new_keluarga) {
      idKeluarga = newId_("KK");
      writeRowAsText_(shKeluarga, lastDataRow_(shKeluarga) + 1,
        [idKeluarga, d.nama_kk, d.alamat, d.telepon], []);
    }

    // 2. Jamaah
    var row = [
      d.id_jamaah || newId_("JM"),
      idKeluarga,
      d.hubungan_keluarga,
      d.nama_lengkap,
      d.nama_absen,
      d.jenis_kelamin,
      d.tahun_lahir,
      d.status_nikah,
      d.is_aktif,
      d.flag_absen,
      d.status_keberadaan,
      d.catatan
    ];
    // Kolom A–L ditulis berurutan; kolom tambahan ditulis per sel sesuai posisi header-nya,
    // jadi kolom lain milik pengguna (mis. rumus Umur) tidak tersentuh.
    var targetRow = foundRowIndex || lastDataRow_(shJamaah) + 1;
    writeRowAsText_(shJamaah, targetRow, row, [6]);
    var cols = sheets.jamaahCols;
    shJamaah.getRange(targetRow, cols.telepon, 1, 1).setNumberFormat('@').setValues([[d.no_telepon]]);
    shJamaah.getRange(targetRow, cols.dibantu, 1, 1).setNumberFormat('@').setValues([[d.perlu_dibantu]]);
    SpreadsheetApp.flush();

    return { success: true, message: d.id_jamaah ? "Data berhasil diperbarui!" : "Data berhasil disimpan!" };
  } catch (err) {
    return errorResponse_(err, err && err.isAuth ? "" : "Gagal menyimpan data: ");
  } finally {
    if (locked) lock.releaseLock();
  }
}

function findRowById_(sheet, id) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return null;
}

/** Validasi & normalisasi input form. Lempar Error berisi pesan yang ramah pengguna. */
function validateFormData_(f, keberadaanList) {
  keberadaanList = keberadaanList || ENUM.KEBERADAAN;
  if (!f || typeof f !== 'object') throw new Error("Data form kosong.");
  var errors = [];
  var tahunSekarang = new Date().getFullYear();

  function text(v, max) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max); }
  function pick(v, list, def) {
    var s = String(v == null ? "" : v).trim();
    if (!s && def !== undefined) return def;
    for (var i = 0; i < list.length; i++) if (list[i].toUpperCase() === s.toUpperCase()) return list[i];
    return null;
  }
  var phoneRe = /^[0-9+\-\s]{6,20}$/;

  var d = {
    id_jamaah: f.id_jamaah ? text(f.id_jamaah, 64) : null,
    is_new_keluarga: f.is_new_keluarga === true || f.is_new_keluarga === 'true',
    tanpa_kk: f.tanpa_kk === true || f.tanpa_kk === 'true',
    id_keluarga: text(f.id_keluarga, 64),
    nama_kk: text(f.nama_kk, 100),
    alamat: text(f.alamat, 300),
    telepon: text(f.telepon, 20),
    nama_lengkap: text(f.nama_lengkap, 100),
    nama_absen: text(f.nama_absen, 100),
    hubungan_keluarga: pick(f.hubungan_keluarga, ENUM.HUBUNGAN),
    jenis_kelamin: pick(f.jenis_kelamin, ENUM.JK),
    tahun_lahir: Number(f.tahun_lahir),
    status_nikah: pick(f.status_nikah, ENUM.STATUS_NIKAH, "BELUM"),
    is_aktif: pick(f.is_aktif, ENUM.YN, "Y"),
    flag_absen: pick(f.flag_absen, ENUM.YN, "Y"),
    status_keberadaan: pick(f.status_keberadaan, keberadaanList, KEBERADAAN_DEFAULT_VALUE),
    catatan: text(f.catatan, 500),
    no_telepon: text(f.no_telepon, 20),
    perlu_dibantu: pick(f.perlu_dibantu, ENUM.YN, "N")
  };

  if (d.is_new_keluarga) {
    if (!d.nama_kk) errors.push("Nama Kepala Keluarga wajib diisi.");
    if (!d.alamat) errors.push("Alamat KK baru wajib diisi.");
    if (d.telepon && !phoneRe.test(d.telepon)) errors.push("No. telepon KK hanya boleh angka, spasi, + atau -.");
  } else if (d.tanpa_kk) {
    d.id_keluarga = ""; // mandiri / perantau: tidak terdaftar di KK mana pun
  } else if (!d.id_keluarga || d.id_keluarga === "NEW") {
    errors.push("Pilih Keluarga (KK) dari daftar, atau buat KK baru.");
  }

  if (!d.nama_lengkap) errors.push("Nama lengkap wajib diisi.");
  if (!d.nama_absen) d.nama_absen = d.nama_lengkap;
  if (!d.hubungan_keluarga) errors.push("Hubungan keluarga tidak valid.");
  if (!d.jenis_kelamin) errors.push("Jenis kelamin harus L atau P.");
  if (!(Math.floor(d.tahun_lahir) === d.tahun_lahir && d.tahun_lahir >= 1900 && d.tahun_lahir <= tahunSekarang)) {
    errors.push("Tahun lahir harus antara 1900 dan " + tahunSekarang + ".");
  }
  if (!d.status_nikah) errors.push("Status pernikahan tidak valid.");
  if (!d.is_aktif || !d.flag_absen || !d.perlu_dibantu) errors.push("Penanda Aktif/Absen/Perlu Dibantu tidak valid.");
  if (!d.status_keberadaan) errors.push("Status keberadaan '" + text(f.status_keberadaan, 30) + "' belum ada di Pengaturan. Tambahkan dulu di menu Pengaturan → Pilihan Status Keberadaan.");
  if (d.status_nikah === "DUDA" && d.jenis_kelamin === "P") errors.push("Status DUDA hanya untuk laki-laki.");
  if (d.status_nikah === "JANDA" && d.jenis_kelamin === "L") errors.push("Status JANDA hanya untuk perempuan.");
  if (d.no_telepon && !phoneRe.test(d.no_telepon)) errors.push("No. telepon jamaah hanya boleh angka, spasi, + atau -.");

  if (errors.length) throw new Error(errors.join(" "));
  return d;
}

/* ======================================================================
 * HAPUS DATA (dengan arsip) & PULIHKAN
 * Baris yang dihapus dipindah ke sheet Arsip_Jamaah / Arsip_Keluarga beserta
 * waktu hapus & alasan (wajib). Jamaah di arsip bisa dipulihkan dari menu
 * "Arsip Terhapus"; baris arsipnya tidak dihapus, hanya diberi "Waktu Pulih"
 * supaya riwayat hapus tetap tercatat.
 * ====================================================================== */

var ARSIP_COL = { WAKTU: "Waktu Hapus", KETERANGAN: "Keterangan", PULIH: "Waktu Pulih" };
var ALASAN_MIN = 3, ALASAN_MAX = 300;
var PREFIX_HAPUS_KK = "[Hapus seluruh KK] ";

/** Alasan hapus wajib diisi: dirapikan, dibatasi panjangnya, dan tidak boleh kosong. */
function cleanAlasan_(alasan) {
  var a = String(alasan == null ? "" : alasan).replace(/\s+/g, " ").trim().slice(0, ALASAN_MAX);
  if (a.length < ALASAN_MIN) throw new Error("Alasan hapus wajib diisi (minimal " + ALASAN_MIN + " karakter).");
  return a;
}

function nowText_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
}

/**
 * Hapus jamaah. Khusus ADMIN.
 * @param {string} token
 * @param {string} idJamaah
 * @param {string} mode 'single' = hanya jamaah ini; 'kk' = seluruh KK beserta anggotanya
 * @param {string} alasan alasan hapus (wajib), dicatat di kolom Keterangan arsip
 */
function deleteJamaah(token, idJamaah, mode, alasan) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    requireSession_(token, [ROLE.ADMIN]);
    if (!idJamaah) throw new Error("ID jamaah kosong.");
    if (mode !== 'single' && mode !== 'kk') throw new Error("Mode hapus tidak valid.");
    var ket = cleanAlasan_(alasan);

    locked = lock.tryLock(15000);
    if (!locked) throw new Error("Server sedang sibuk. Coba lagi sebentar.");

    var ss = getSpreadsheet_();
    var sheets = initializeSheets_(ss);
    var row = findRowById_(sheets.jamaah, idJamaah);
    if (!row) throw new Error("Data jamaah tidak ditemukan (mungkin sudah dihapus).");

    if (mode === 'kk') {
      var idKeluarga = String(sheets.jamaah.getRange(row, 2, 1, 1).getValues()[0][0]).trim();
      // Tanpa ID KK, "hapus seluruh KK" akan mengenai SEMUA jamaah mandiri -> tolak
      if (!idKeluarga) throw new Error("Jamaah ini tidak terdaftar di KK mana pun. Gunakan hapus per orang.");
      var res = deleteKeluargaRows_(ss, sheets, idKeluarga, PREFIX_HAPUS_KK + ket);
      return { success: true, message: "Keluarga beserta " + res.jamaah + " anggota dihapus dan disimpan di arsip.", deleted: res };
    }

    archiveAndDeleteRows_(ss, sheets.jamaah, CONFIG.SHEET_ARSIP_JAMAAH, [row], ket);
    SpreadsheetApp.flush();
    return { success: true, message: "Data jamaah dihapus dan disimpan di arsip.", deleted: { jamaah: 1, keluarga: 0 } };
  } catch (err) {
    return errorResponse_(err, err && err.isAuth ? "" : "Gagal menghapus: ");
  } finally {
    if (locked) lock.releaseLock();
  }
}

/** Hapus satu KK beserta seluruh anggotanya. Khusus ADMIN. Alasan wajib. */
function deleteKeluarga(token, idKeluarga, alasan) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    requireSession_(token, [ROLE.ADMIN]);
    if (!idKeluarga) throw new Error("ID keluarga kosong.");
    var ket = cleanAlasan_(alasan);

    locked = lock.tryLock(15000);
    if (!locked) throw new Error("Server sedang sibuk. Coba lagi sebentar.");

    var ss = getSpreadsheet_();
    var sheets = initializeSheets_(ss);
    if (!findRowById_(sheets.keluarga, idKeluarga)) throw new Error("Data keluarga tidak ditemukan (mungkin sudah dihapus).");
    var res = deleteKeluargaRows_(ss, sheets, String(idKeluarga), PREFIX_HAPUS_KK + ket);
    return { success: true, message: "Keluarga beserta " + res.jamaah + " anggota dihapus dan disimpan di arsip.", deleted: res };
  } catch (err) {
    return errorResponse_(err, err && err.isAuth ? "" : "Gagal menghapus: ");
  } finally {
    if (locked) lock.releaseLock();
  }
}

function deleteKeluargaRows_(ss, sheets, idKeluarga, keterangan) {
  var memberRows = [];
  var last = sheets.jamaah.getLastRow();
  if (last > 1) {
    var vals = sheets.jamaah.getRange(2, 2, last - 1, 1).getValues();
    for (var i = 0; i < vals.length; i++) if (String(vals[i][0]) === idKeluarga) memberRows.push(i + 2);
  }
  archiveAndDeleteRows_(ss, sheets.jamaah, CONFIG.SHEET_ARSIP_JAMAAH, memberRows, keterangan);
  var kkRow = findRowById_(sheets.keluarga, idKeluarga);
  if (kkRow) archiveAndDeleteRows_(ss, sheets.keluarga, CONFIG.SHEET_ARSIP_KELUARGA, [kkRow], keterangan);
  SpreadsheetApp.flush();
  return { jamaah: memberRows.length, keluarga: kkRow ? 1 : 0 };
}

/** Nama kolom header; kolom tanpa judul diberi nama "Kolom X" agar isinya tetap terarsip. */
function headerNames_(header) {
  return header.map(function (h, i) {
    var n = String(h == null ? "" : h).trim();
    return n || ("Kolom " + columnLetter_(i + 1));
  });
}

/**
 * Pastikan sheet arsip ada & header-nya memuat semua nama kolom yang diminta
 * (kolom yang belum ada ditambah di ujung kanan). Mengembalikan peta nama -> kolom (1-based).
 */
function ensureArsipHeader_(ss, archiveName, names) {
  var arsip = ss.getSheetByName(archiveName);
  if (!arsip) {
    arsip = ss.insertSheet(archiveName);
    arsip.appendRow(names);
  }
  var width = Math.max(arsip.getLastColumn(), 1);
  var header = headerNames_(arsip.getRange(1, 1, 1, width).getValues()[0]);
  var map = {};
  header.forEach(function (h, i) { if (!map[h]) map[h] = i + 1; });
  names.forEach(function (n) {
    if (!map[n]) {
      width++;
      arsip.getRange(1, width, 1, 1).setValues([[n]]);
      map[n] = width;
    }
  });
  return { sheet: arsip, map: map, width: width };
}

/**
 * Salin baris (semua kolom, termasuk kolom tambahan milik pengguna) ke sheet arsip
 * beserta waktu & keterangan (dicocokkan per NAMA kolom), lalu hapus dari sheet asal,
 * dari bawah ke atas.
 */
function archiveAndDeleteRows_(ss, sheet, archiveName, rowIndexes, keterangan) {
  if (!rowIndexes.length) return;
  var width = sheet.getLastColumn();
  var names = sourceNamesForArsip_(headerNames_(sheet.getRange(1, 1, 1, width).getValues()[0]));
  var a = ensureArsipHeader_(ss, archiveName, [ARSIP_COL.WAKTU, ARSIP_COL.KETERANGAN].concat(names).concat([ARSIP_COL.PULIH]));
  var waktu = nowText_();
  var sorted = rowIndexes.slice().sort(function (x, y) { return y - x; });
  sorted.forEach(function (r) {
    var values = sheet.getRange(r, 1, 1, width).getValues()[0];
    var out = [];
    for (var c = 0; c < a.width; c++) out.push('');
    out[a.map[ARSIP_COL.WAKTU] - 1] = waktu;
    out[a.map[ARSIP_COL.KETERANGAN] - 1] = keterangan;
    names.forEach(function (n, i) { out[a.map[n] - 1] = values[i]; });
    writeRowAsText_(a.sheet, lastDataRow_(a.sheet) + 1, out, []);
  });
  sorted.forEach(function (r) { sheet.deleteRow(r); });
}

/**
 * Nama kolom asal untuk arsip. Kolom milik pengguna yang namanya sama dengan kolom
 * arsip (mis. "Keterangan") diberi akhiran " (data asal)", dan nama kembar diberi
 * nomor, supaya isinya tidak menimpa alasan hapus / kolom lain.
 */
function sourceNamesForArsip_(names) {
  var reserved = [ARSIP_COL.WAKTU, ARSIP_COL.KETERANGAN, ARSIP_COL.PULIH];
  var seen = {};
  return names.map(function (n) {
    var name = reserved.indexOf(n) !== -1 ? n + " (data asal)" : n;
    var base = name, k = 2;
    while (seen[name]) name = base + " (" + (k++) + ")";
    seen[name] = true;
    return name;
  });
}

/** Baca sheet arsip sebagai daftar objek {row, get(nama)}. */
function readArsip_(ss, archiveName) {
  var sh = ss.getSheetByName(archiveName);
  if (!sh) return { sheet: null, rows: [], map: {} };
  var last = lastDataRow_(sh), width = sh.getLastColumn();
  var header = headerNames_(sh.getRange(1, 1, 1, width).getValues()[0]);
  var map = {};
  header.forEach(function (h, i) { if (!map[h]) map[h] = i + 1; });
  var data = last > 1 ? sh.getRange(2, 1, last - 1, width).getValues() : [];
  var rows = data.map(function (vals, i) {
    return {
      row: i + 2,
      get: function (name) { var c = map[name]; return c ? String(vals[c - 1] == null ? '' : vals[c - 1]).trim() : ''; }
    };
  });
  return { sheet: sh, rows: rows, map: map };
}

/** Baris arsip KK terbaru yang belum dipulihkan untuk ID tertentu (atau null). */
function findArsipKeluarga_(arsipKK, idKeluarga) {
  for (var i = arsipKK.rows.length - 1; i >= 0; i--) {
    var r = arsipKK.rows[i];
    if (r.get(HEADER_KELUARGA[0]) === idKeluarga && !r.get(ARSIP_COL.PULIH)) return r;
  }
  return null;
}

/** Daftar jamaah yang dihapus & belum dipulihkan, terbaru di atas. Khusus ADMIN. */
function getArsipJamaah(token) {
  try {
    requireSession_(token, [ROLE.ADMIN]);
    var ss = getSpreadsheet_();
    var sheets = initializeSheets_(ss);
    var arsip = readArsip_(ss, CONFIG.SHEET_ARSIP_JAMAAH);
    var arsipKK = readArsip_(ss, CONFIG.SHEET_ARSIP_KELUARGA);

    var kkAktif = {};
    var lastK = lastDataRow_(sheets.keluarga);
    if (lastK > 1) sheets.keluarga.getRange(2, 1, lastK - 1, 2).getValues().forEach(function (r) { kkAktif[String(r[0]).trim()] = String(r[1]).trim(); });
    var jamaahAda = {};
    var lastJ = lastDataRow_(sheets.jamaah);
    if (lastJ > 1) sheets.jamaah.getRange(2, 1, lastJ - 1, 1).getValues().forEach(function (r) { jamaahAda[String(r[0]).trim()] = true; });

    var H = HEADER_JAMAAH;
    var list = arsip.rows.filter(function (r) { return r.get(H[0]) && !r.get(ARSIP_COL.PULIH); }).map(function (r) {
      var idKK = r.get(H[1]);
      var kkStatus = '', kkNama = '';
      if (!idKK) { kkStatus = 'tanpa'; }
      else if (kkAktif[idKK] !== undefined) { kkStatus = 'ada'; kkNama = kkAktif[idKK]; }
      else {
        var ak = findArsipKeluarga_(arsipKK, idKK);
        if (ak) { kkStatus = 'arsip'; kkNama = ak.get(HEADER_KELUARGA[1]); } else { kkStatus = 'hilang'; }
      }
      var tl = parseInt(r.get(H[6]), 10);
      return {
        row: r.row,
        waktu_hapus: r.get(ARSIP_COL.WAKTU),
        keterangan: r.get(ARSIP_COL.KETERANGAN),
        id_jamaah: r.get(H[0]), id_keluarga: idKK, hubungan_keluarga: r.get(H[2]),
        nama_lengkap: r.get(H[3]), nama_absen: r.get(H[4]), jenis_kelamin: r.get(H[5]),
        tahun_lahir: isNaN(tl) ? null : tl, status_nikah: r.get(H[7]),
        no_telepon: r.get(H[12]),
        nama_kk: kkNama, kk_status: kkStatus,
        sudah_ada: !!jamaahAda[r.get(H[0])]
      };
    });
    list.sort(function (a, b) { return a.waktu_hapus < b.waktu_hapus ? 1 : a.waktu_hapus > b.waktu_hapus ? -1 : b.row - a.row; });
    return { success: true, data: list };
  } catch (err) {
    return errorResponse_(err, err && err.isAuth ? "" : "Gagal memuat arsip: ");
  }
}

/**
 * Pulihkan satu jamaah dari arsip ke sheet Jamaah dengan data persis seperti saat dihapus.
 * Bila KK-nya ikut terhapus, KK dipulihkan juga dari Arsip_Keluarga; bila KK sudah tidak ada
 * di mana pun, jamaah dipulihkan sebagai jamaah tanpa KK. Khusus ADMIN.
 * @param {number} arsipRow nomor baris di Arsip_Jamaah (dari getArsipJamaah)
 * @param {string} idJamaah dicocokkan ulang supaya tidak salah baris bila arsip berubah
 */
function restoreJamaah(token, arsipRow, idJamaah) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    requireSession_(token, [ROLE.ADMIN]);
    if (!idJamaah) throw new Error("ID jamaah kosong.");
    locked = lock.tryLock(15000);
    if (!locked) throw new Error("Server sedang sibuk. Coba lagi sebentar.");

    var ss = getSpreadsheet_();
    var sheets = initializeSheets_(ss);
    var arsip = readArsip_(ss, CONFIG.SHEET_ARSIP_JAMAAH);
    var H = HEADER_JAMAAH;
    var rec = arsip.rows.filter(function (r) { return r.row === Number(arsipRow); })[0];
    if (!rec || rec.get(H[0]) !== String(idJamaah)) throw new Error("Data arsip tidak ditemukan atau sudah berubah. Muat ulang daftar arsip.");
    if (rec.get(ARSIP_COL.PULIH)) throw new Error("Jamaah ini sudah dipulihkan sebelumnya.");
    if (findRowById_(sheets.jamaah, idJamaah)) throw new Error("Jamaah dengan ID " + idJamaah + " sudah ada di data aktif.");

    var waktu = nowText_();
    var catatanKK = "";
    var idKeluarga = rec.get(H[1]);
    if (idKeluarga && !findRowById_(sheets.keluarga, idKeluarga)) {
      var arsipKK = readArsip_(ss, CONFIG.SHEET_ARSIP_KELUARGA);
      var ak = findArsipKeluarga_(arsipKK, idKeluarga);
      if (ak) {
        writeRowAsText_(sheets.keluarga, lastDataRow_(sheets.keluarga) + 1,
          HEADER_KELUARGA.map(function (n) { return ak.get(n); }), []);
        markPulih_(arsipKK, ak.row, waktu);
        catatanKK = " Data KK " + ak.get(HEADER_KELUARGA[1]) + " ikut dipulihkan.";
      } else {
        idKeluarga = "";
        catatanKK = " KK lamanya sudah tidak ada, jadi dipulihkan sebagai jamaah tanpa KK.";
      }
    }

    var tl = parseInt(rec.get(H[6]), 10);
    var row = H.slice(0, JAMAAH_CORE_COLS).map(function (n) { return rec.get(n); });
    row[1] = idKeluarga;
    row[6] = isNaN(tl) ? '' : tl;
    var target = lastDataRow_(sheets.jamaah) + 1;
    writeRowAsText_(sheets.jamaah, target, row, [6]);
    var cols = sheets.jamaahCols;
    sheets.jamaah.getRange(target, cols.telepon, 1, 1).setNumberFormat('@').setValues([[rec.get(H[12])]]);
    sheets.jamaah.getRange(target, cols.dibantu, 1, 1).setNumberFormat('@').setValues([[rec.get(H[13]) || 'N']]);
    markPulih_(arsip, rec.row, waktu);
    SpreadsheetApp.flush();
    return { success: true, message: rec.get(H[3]) + " dipulihkan ke data jamaah." + catatanKK };
  } catch (err) {
    return errorResponse_(err, err && err.isAuth ? "" : "Gagal memulihkan: ");
  } finally {
    if (locked) lock.releaseLock();
  }
}

/** Tandai baris arsip sudah dipulihkan (kolom "Waktu Pulih" dibuat bila belum ada). */
function markPulih_(arsip, row, waktu) {
  var col = arsip.map[ARSIP_COL.PULIH];
  if (!col) {
    col = arsip.sheet.getLastColumn() + 1;
    arsip.sheet.getRange(1, col, 1, 1).setValues([[ARSIP_COL.PULIH]]);
    arsip.map[ARSIP_COL.PULIH] = col;
  }
  arsip.sheet.getRange(row, col, 1, 1).setNumberFormat('@').setValues([[waktu]]);
}

/* ======================================================================
 * PENGATURAN KATEGORI (API)
 * ====================================================================== */

/** Simpan konfigurasi kategori usia. Khusus ADMIN. */
function saveKategoriConfig(token, cfg) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    requireSession_(token, [ROLE.ADMIN]);
    var clean = validateKategoriConfig_(cfg);
    locked = lock.tryLock(15000);
    if (!locked) throw new Error("Server sedang sibuk. Coba lagi sebentar.");
    writeKategoriSheet_(getSpreadsheet_(), clean);
    SpreadsheetApp.flush();
    return { success: true, message: "Pengaturan kategori usia disimpan.", config: clean };
  } catch (err) {
    return errorResponse_(err, err && err.isAuth ? "" : "Gagal menyimpan pengaturan: ");
  } finally {
    if (locked) lock.releaseLock();
  }
}

/**
 * Simpan pilihan Status Keberadaan. Khusus ADMIN.
 * Pilihan yang masih dipakai jamaah tidak boleh dihapus.
 */
function saveKeberadaanConfig(token, list) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    requireSession_(token, [ROLE.ADMIN]);
    var clean = validateKeberadaanList_(list);
    locked = lock.tryLock(15000);
    if (!locked) throw new Error("Server sedang sibuk. Coba lagi sebentar.");
    var ss = getSpreadsheet_();
    var lama = getKeberadaanList_(ss);
    var dihapus = lama.filter(function (v) {
      return !clean.some(function (c) { return c.toUpperCase() === v.toUpperCase(); });
    });
    if (dihapus.length) {
      var sheets = initializeSheets_(ss);
      var last = lastDataRow_(sheets.jamaah);
      var nilai = last > 1 ? sheets.jamaah.getRange(2, 11, last - 1, 1).getValues() : [];
      var dipakai = dihapus.map(function (v) {
        var n = nilai.filter(function (r) { return String(r[0]).trim().toUpperCase() === v.toUpperCase(); }).length;
        return { v: v, n: n };
      }).filter(function (x) { return x.n > 0; });
      if (dipakai.length) {
        throw new Error("Tidak bisa menghapus " + dipakai.map(function (x) { return "'" + x.v + "' (masih dipakai " + x.n + " jamaah)"; }).join(", ") +
          ". Ubah dulu status keberadaan jamaah tersebut.");
      }
    }
    writeKeberadaanSheet_(ss, clean);
    SpreadsheetApp.flush();
    return { success: true, message: "Pilihan status keberadaan disimpan.", options: clean };
  } catch (err) {
    return errorResponse_(err, err && err.isAuth ? "" : "Gagal menyimpan pengaturan: ");
  } finally {
    if (locked) lock.releaseLock();
  }
}

/* ======================================================================
 * MIGRASI DATA LAMA
 * ====================================================================== */

/**
 * Script Migrasi Data Sensus Lama ke Struktur Baru.
 * HANYA dijalankan pemilik dari Apps Script Editor (Run -> jalankanMigrasiSensus).
 *
 * CARA MENGGUNAKAN:
 * 1. Letakkan seluruh data sensus lama pada tab sheet bernama "Sensus_Asal".
 * 2. Urutan kolom "Sensus_Asal":
 *    A: No | B: Aktif (Y/N) | C: Nama Lengkap | D: Nama di Absen | E: Kode Hubungan KK (A/B/C/D)
 *    F: Jenis Kelamin (L/P) | G: Tahun Lahir | H: Umur | I: Absen (Y/N/Mondok/Tugas/Kerja Luar)
 *    J: Kategori Usia | K: Status Nikah | L: Catatan
 * 3. Jalankan fungsi ini. Data lama di sheet Keluarga & Jamaah otomatis di-backup
 *    ke tab "Backup_..." sebelum ditimpa.
 * 4. Setelah verifikasi, HAPUS tab "Sensus_Asal" supaya migrasi tidak terjalankan ulang.
 */
function jalankanMigrasiSensus() {
  try {
    assertEditorRun_();
    var ss = getSpreadsheet_();

    var sheetAsal = ss.getSheetByName(CONFIG.SHEET_SUMBER_MIGRASI);
    if (!sheetAsal) {
      throw new Error("Sheet bernama '" + CONFIG.SHEET_SUMBER_MIGRASI + "' tidak ditemukan.");
    }

    // Validasi sumber SEBELUM menghapus apa pun
    var lastRowAsal = sheetAsal.getLastRow();
    if (lastRowAsal <= 1) {
      throw new Error("Sheet '" + CONFIG.SHEET_SUMBER_MIGRASI + "' kosong atau hanya berisi header. Tidak ada data yang diubah.");
    }
    var dataAsal = sheetAsal.getRange(2, 1, lastRowAsal - 1, 12).getValues();

    var tahunSekarang = new Date().getFullYear();
    var keberadaanList = getKeberadaanList_(ss);
    var currentKeluargaId = "";
    var keluargaRows = [];
    var jamaahRows = [];
    var peringatan = [];

    for (var i = 0; i < dataAsal.length; i++) {
      var row = dataAsal[i];
      var namaLengkap = String(row[2]).trim();
      if (!namaLengkap) continue;

      var aktifVal = String(row[1]).toUpperCase().trim();
      var namaAbsen = String(row[3]).trim() || namaLengkap;
      var hubKeluarga = String(row[4]).toUpperCase().trim() || "C";
      var jk = String(row[5]).toUpperCase().trim();
      var tahunLahir = Number(row[6]);
      var absenVal = String(row[8]).trim();
      var statusNikahVal = String(row[10]).toUpperCase().trim();
      var catatan = String(row[11]).trim();

      if (ENUM.JK.indexOf(jk) === -1) { peringatan.push("Baris " + (i + 2) + ": jenis kelamin '" + jk + "' tidak valid"); }
      if (!(tahunLahir >= 1900 && tahunLahir <= tahunSekarang)) {
        peringatan.push("Baris " + (i + 2) + ": tahun lahir '" + row[6] + "' tidak valid (dikosongkan)");
        tahunLahir = "";
      }

      var isAktif = (aktifVal === "N") ? "N" : "Y";

      var flagAbsen = "Y";
      var statusKeberadaan = "Menetap";
      var lowerAbsen = absenVal.toLowerCase();
      var cocok = matchKeberadaan_(absenVal, keberadaanList);
      if (absenVal && cocok.known && cocok.value !== KEBERADAAN_DEFAULT_VALUE) {
        statusKeberadaan = cocok.value; // mis. Mondok, Tugas, Kerja Luar, Sekolah di Luar
        flagAbsen = "N";
      } else if (lowerAbsen === "n") {
        flagAbsen = "N";
      }

      var statusNikah = "BELUM";
      if (statusNikahVal.indexOf("MENIKAH") !== -1) statusNikah = "MENIKAH";
      else if (statusNikahVal.indexOf("JANDA") !== -1) statusNikah = "JANDA";
      else if (statusNikahVal.indexOf("DUDA") !== -1) statusNikah = "DUDA";

      // Pengelompokan KK berdasarkan urutan baris: 'A' memulai keluarga baru
      if (hubKeluarga === "A" || !currentKeluargaId) {
        if (hubKeluarga !== "A") peringatan.push("Baris " + (i + 2) + ": anggota tanpa Kepala Keluarga di atasnya, dibuat KK sendiri");
        currentKeluargaId = newId_("KK");
        keluargaRows.push([currentKeluargaId, namaLengkap, "Alamat Babakan Barat", ""]);
      }

      jamaahRows.push([
        newId_("JM"), currentKeluargaId, hubKeluarga, namaLengkap, namaAbsen, jk,
        tahunLahir, statusNikah, isAktif, flagAbsen, statusKeberadaan, catatan
      ]);
    }

    if (jamaahRows.length === 0) {
      throw new Error("Tidak ada baris bernama di '" + CONFIG.SHEET_SUMBER_MIGRASI + "'. Tidak ada data yang diubah.");
    }

    var sheets = initializeSheets_(ss);
    var shKeluarga = sheets.keluarga;
    var shJamaah = sheets.jamaah;

    // Backup sebelum menimpa
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd_HHmm");
    if (shKeluarga.getLastRow() > 1) shKeluarga.copyTo(ss).setName("Backup_Keluarga_" + stamp);
    if (shJamaah.getLastRow() > 1) shJamaah.copyTo(ss).setName("Backup_Jamaah_" + stamp);

    if (shKeluarga.getLastRow() > 1) {
      shKeluarga.getRange(2, 1, shKeluarga.getLastRow() - 1, shKeluarga.getLastColumn()).clearContent();
    }
    if (shJamaah.getLastRow() > 1) {
      // Hanya kolom milik aplikasi yang dikosongkan; kolom tambahan pengguna (mis. rumus) dibiarkan
      var jl = shJamaah.getLastRow() - 1;
      shJamaah.getRange(2, 1, jl, JAMAAH_CORE_COLS).clearContent();
      shJamaah.getRange(2, sheets.jamaahCols.telepon, jl, 1).clearContent();
      shJamaah.getRange(2, sheets.jamaahCols.dibantu, jl, 1).clearContent();
    }

    shKeluarga.getRange(2, 1, keluargaRows.length, 4).setNumberFormat('@').setValues(keluargaRows);
    var jRange = shJamaah.getRange(2, 1, jamaahRows.length, 12);
    jRange.setNumberFormat('@');
    shJamaah.getRange(2, 7, jamaahRows.length, 1).setNumberFormat('0');
    jRange.setValues(jamaahRows);

    var msg = "Migrasi sukses! Memproses " + keluargaRows.length + " KK dan " + jamaahRows.length + " Jiwa.";
    if (peringatan.length) msg += " Perlu dicek (" + peringatan.length + "): " + peringatan.join("; ");
    Logger.log(msg);
    return { success: true, message: msg };
  } catch (err) {
    Logger.log("Migrasi gagal: " + err.toString());
    return { success: false, message: "Gagal: " + err.message };
  }
}