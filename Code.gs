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
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  if (CONFIG.ALLOW_EMBED) {
    out.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }
  return out;
}

/**
 * JSON API untuk frontend di luar Apps Script (mis. GitHub Pages).
 * Body (text/plain): {"action": "login" | "logout" | "getSensusData" | "saveSensusData" |
 *                    "deleteJamaah" | "deleteKeluarga" | "saveKategoriConfig", "args": [...]}
 * Hanya aksi di daftar ini yang bisa dipanggil; migrasi & fungsi internal tidak terekspos.
 * Keamanan tetap sama: setiap aksi (kecuali login) memeriksa token sesi dari PIN.
 */
var API_ACTIONS = {
  login: function (args) { return login(args[0], args[1]); },
  logout: function (args) { return logout(args[0]); },
  getSensusData: function (args) { return getSensusData(args[0]); },
  saveSensusData: function (args) { return saveSensusData(args[0], args[1]); },
  deleteJamaah: function (args) { return deleteJamaah(args[0], args[1], args[2]); },
  deleteKeluarga: function (args) { return deleteKeluarga(args[0], args[1]); },
  saveKategoriConfig: function (args) { return saveKategoriConfig(args[0], args[1]); }
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
    var adminPin = String(props.getProperty('ADMIN_PIN') || '');
    var viewerPin = String(props.getProperty('VIEWER_PIN') || '');
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
        status_keberadaan: String(jRow[10]),
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

  return { jamaah: jamaahList, keluarga: keluargaList, rekap: rekap, kategoriConfig: cfg, warnings: warnings };
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
  return { jamaah: jamaah, keluarga: [], rekap: rekap };
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
    var d = validateFormData_(formData);

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
function validateFormData_(f) {
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
    status_keberadaan: pick(f.status_keberadaan, ENUM.KEBERADAAN, "Menetap"),
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
  if (!d.status_keberadaan) errors.push("Status keberadaan tidak valid.");
  if (d.status_nikah === "DUDA" && d.jenis_kelamin === "P") errors.push("Status DUDA hanya untuk laki-laki.");
  if (d.status_nikah === "JANDA" && d.jenis_kelamin === "L") errors.push("Status JANDA hanya untuk perempuan.");
  if (d.no_telepon && !phoneRe.test(d.no_telepon)) errors.push("No. telepon jamaah hanya boleh angka, spasi, + atau -.");

  if (errors.length) throw new Error(errors.join(" "));
  return d;
}

/* ======================================================================
 * HAPUS DATA (dengan arsip)
 * Baris yang dihapus dipindah ke sheet Arsip_Jamaah / Arsip_Keluarga
 * beserta waktu & keterangan, sehingga bisa dipulihkan manual (salin balik).
 * ====================================================================== */

/**
 * Hapus jamaah. Khusus ADMIN.
 * @param {string} token
 * @param {string} idJamaah
 * @param {string} mode 'single' = hanya jamaah ini; 'kk' = seluruh KK beserta anggotanya
 */
function deleteJamaah(token, idJamaah, mode) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    requireSession_(token, [ROLE.ADMIN]);
    if (!idJamaah) throw new Error("ID jamaah kosong.");
    if (mode !== 'single' && mode !== 'kk') throw new Error("Mode hapus tidak valid.");

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
      var res = deleteKeluargaRows_(ss, sheets, idKeluarga, "Hapus seluruh KK (dari jamaah " + idJamaah + ")");
      return { success: true, message: "Keluarga beserta " + res.jamaah + " anggota dihapus dan disimpan di arsip.", deleted: res };
    }

    archiveAndDeleteRows_(ss, sheets.jamaah, CONFIG.SHEET_ARSIP_JAMAAH, [row], "Hapus jamaah");
    SpreadsheetApp.flush();
    return { success: true, message: "Data jamaah dihapus dan disimpan di arsip.", deleted: { jamaah: 1, keluarga: 0 } };
  } catch (err) {
    return errorResponse_(err, err && err.isAuth ? "" : "Gagal menghapus: ");
  } finally {
    if (locked) lock.releaseLock();
  }
}

/** Hapus satu KK beserta seluruh anggotanya. Khusus ADMIN. */
function deleteKeluarga(token, idKeluarga) {
  var lock = LockService.getScriptLock();
  var locked = false;
  try {
    requireSession_(token, [ROLE.ADMIN]);
    if (!idKeluarga) throw new Error("ID keluarga kosong.");

    locked = lock.tryLock(15000);
    if (!locked) throw new Error("Server sedang sibuk. Coba lagi sebentar.");

    var ss = getSpreadsheet_();
    var sheets = initializeSheets_(ss);
    if (!findRowById_(sheets.keluarga, idKeluarga)) throw new Error("Data keluarga tidak ditemukan (mungkin sudah dihapus).");
    var res = deleteKeluargaRows_(ss, sheets, String(idKeluarga), "Hapus seluruh KK");
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

/**
 * Salin baris (semua kolom, termasuk kolom tambahan milik pengguna) ke sheet arsip
 * beserta waktu & keterangan, lalu hapus dari sheet asal, dari bawah ke atas.
 */
function archiveAndDeleteRows_(ss, sheet, archiveName, rowIndexes, keterangan) {
  if (!rowIndexes.length) return;
  var width = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, width).getValues()[0];
  var arsip = ss.getSheetByName(archiveName);
  if (!arsip) {
    arsip = ss.insertSheet(archiveName);
    arsip.appendRow(["Waktu Hapus", "Keterangan"].concat(header));
  }
  var waktu = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
  var sorted = rowIndexes.slice().sort(function (a, b) { return b - a; });
  sorted.forEach(function (r) {
    var values = sheet.getRange(r, 1, 1, width).getValues()[0];
    writeRowAsText_(arsip, lastDataRow_(arsip) + 1, [waktu, keterangan].concat(values), []);
  });
  sorted.forEach(function (r) { sheet.deleteRow(r); });
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
      if (lowerAbsen === "mondok" || lowerAbsen === "tugas" || lowerAbsen === "kerja luar") {
        statusKeberadaan = absenVal;
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