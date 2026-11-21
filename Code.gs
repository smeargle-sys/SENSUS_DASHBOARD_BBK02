/**
 * Sensus Jamaah Babakan Barat - Google Apps Script Backend
 * File ini menangani server-side logic, interaksi dengan Google Sheets,
 * otomatisasi perhitungan kategori usia, rekapitulasi data, dan akses PIN.
 *
 * KEAMANAN (WAJIB DIBACA):
 * - Semua fungsi yang TIDAK berakhiran "_" bisa dipanggil dari browser lewat
 *   google.script.run. Karena itu setiap fungsi publik di bawah memeriksa token sesi.
 * - PIN disimpan di Script Properties (Project Settings -> Script Properties):
 *     ADMIN_PIN  : PIN untuk halaman editor (tambah/edit data)
 *     VIEWER_PIN : PIN untuk halaman ringkasan (?page=view)
 *   Gunakan minimal 6 digit dan jangan dibagikan di grup umum.
 */

var CONFIG = {
  SHEET_KELUARGA: "Keluarga",
  SHEET_JAMAAH: "Jamaah",
  SHEET_SUMBER_MIGRASI: "Sensus_Asal",
  FALLBACK_URL: "", // Masukkan URL Google Spreadsheet Anda di sini jika dijalankan di luar konteks container

  // Sesi login (detik). Maksimum CacheService = 21600 (6 jam).
  SESSION_TTL_SEC: 21600,
  // Proteksi tebak PIN: setelah MAX_FAIL kali salah, login dikunci LOCK_SEC detik.
  MAX_FAIL: 5,
  LOCK_SEC: 900,
  MIN_PIN_LENGTH: 6,

  // true hanya jika aplikasi di-embed di situs lain (mis. Google Sites).
  ALLOW_EMBED: false,

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
 * Body (text/plain): {"action": "login" | "logout" | "getSensusData" | "saveSensusData", "args": [...]}
 * Hanya aksi di daftar ini yang bisa dipanggil; migrasi & fungsi internal tidak terekspos.
 * Keamanan tetap sama: setiap aksi (kecuali login) memeriksa token sesi dari PIN.
 */
var API_ACTIONS = {
  login: function (args) { return login(args[0], args[1]); },
  logout: function (args) { return logout(args[0]); },
  getSensusData: function (args) { return getSensusData(args[0]); },
  saveSensusData: function (args) { return saveSensusData(args[0], args[1]); }
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

/** Membuat sheet Keluarga & Jamaah dengan header standar jika belum ada. */
function initializeSheets_(ss) {
  var keluargaSheet = ss.getSheetByName(CONFIG.SHEET_KELUARGA);
  if (!keluargaSheet) {
    keluargaSheet = ss.insertSheet(CONFIG.SHEET_KELUARGA);
    keluargaSheet.appendRow(["ID Keluarga", "Nama KK", "Alamat", "No Telepon"]);
  }

  var jamaahSheet = ss.getSheetByName(CONFIG.SHEET_JAMAAH);
  if (!jamaahSheet) {
    jamaahSheet = ss.insertSheet(CONFIG.SHEET_JAMAAH);
    jamaahSheet.appendRow([
      "ID Jamaah", "ID Keluarga", "Hubungan Keluarga", "Nama Lengkap",
      "Nama Absen", "Jenis Kelamin", "Tahun Lahir", "Status Nikah",
      "Status Keaktifan", "Flag Absen", "Status Keberadaan", "Catatan"
    ]);
  }
  return { keluarga: keluargaSheet, jamaah: jamaahSheet };
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
 * RULE ENGINE
 * ====================================================================== */

/**
 * Menentukan Kategori Usia secara dinamis.
 * @param {number} tahunLahir
 * @param {string} statusNikah
 * @return {string} Kategori Usia
 */
function dapatkanKategoriUsia(tahunLahir, statusNikah) {
  var status = (statusNikah || "").toUpperCase().trim();
  if (status === "MENIKAH" || status === "DUDA" || status === "JANDA") {
    return "Dewasa Menikah";
  }
  if (!tahunLahir) return "Tanpa Tahun Lahir";

  var umur = new Date().getFullYear() - tahunLahir;
  if (umur <= 5) return "BALITA-PAUD";
  if (umur <= 12) return "Caberawit";
  if (umur <= 15) return "Pra Remaja (SMP)";
  if (umur <= 17) return "Remaja (SMA)";
  return "Usia (Pra) Menikah";
}

/* ======================================================================
 * BACA DATA
 * ====================================================================== */

/**
 * Mengambil data sensus + rekap.
 * ADMIN  : seluruh data (termasuk alamat, telepon, catatan).
 * VIEWER : hanya jamaah aktif & masuk absen, tanpa data kontak/catatan.
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
  var shKeluarga = sheets.keluarga;
  var shJamaah = sheets.jamaah;

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
  var jamaahList = [];
  var rekap = {
    total: 0,
    laki: 0,
    perempuan: 0,
    duda: 0,
    janda: 0,
    lansia: 0,
    kkCount: 0,
    tanpaTahunLahir: 0,
    detail: {
      "BALITA-PAUD": { L: 0, P: 0 },
      "Caberawit": { L: 0, P: 0 },
      "Pra Remaja (SMP)": { L: 0, P: 0 },
      "Remaja (SMA)": { L: 0, P: 0 },
      "Usia (Pra) Menikah": { L: 0, P: 0 },
      "Dewasa Menikah": { L: 0, P: 0 }
    }
  };
  var inactiveKeluargaIds = {};
  var tahunSekarang = new Date().getFullYear();

  var lastRowJamaah = shJamaah.getLastRow();
  if (lastRowJamaah > 1) {
    var valJamaah = shJamaah.getRange(2, 1, lastRowJamaah - 1, 12).getValues();

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

      if (hubKeluarga === "A" && isAktif === "N") {
        inactiveKeluargaIds[idKeluarga] = true;
      }

      var umur = tahunLahir ? tahunSekarang - tahunLahir : null;
      var kategoriUsia = dapatkanKategoriUsia(tahunLahir, statusNikah);

      jamaahList.push({
        id_jamaah: String(jRow[0]),
        id_keluarga: idKeluarga,
        nama_kk: keluargaMap[idKeluarga] || "Tidak Terdaftar",
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
        catatan: String(jRow[11])
      });

      // Agregasi rekap (hanya jamaah aktif wilayah)
      if (isAktif === "Y") {
        rekap.total++;
        if (jk === "L") rekap.laki++;
        else if (jk === "P") rekap.perempuan++;

        if (statusNikah === "DUDA") rekap.duda++;
        else if (statusNikah === "JANDA") rekap.janda++;

        if (umur !== null && umur >= CONFIG.BATAS_LANSIA) rekap.lansia++;
        if (!tahunLahir) rekap.tanpaTahunLahir++;

        if (rekap.detail[kategoriUsia] && (jk === "L" || jk === "P") &&
            statusNikah !== "DUDA" && statusNikah !== "JANDA") {
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

  return { jamaah: jamaahList, keluarga: keluargaList, rekap: rekap };
}

/** Data untuk halaman ringkasan: tanpa alamat, telepon, catatan, ID, dan jamaah non-absen. */
function toPublicData_(full) {
  var jamaah = full.jamaah
    .filter(function (j) { return j.is_aktif === "Y" && j.flag_absen === "Y"; })
    .map(function (j) {
      return {
        nama_lengkap: j.nama_lengkap,
        nama_absen: j.nama_absen,
        hubungan_keluarga: j.hubungan_keluarga,
        nama_kk: j.nama_kk,
        jenis_kelamin: j.jenis_kelamin,
        umur: j.umur,
        kategori_usia: j.kategori_usia,
        is_aktif: j.is_aktif,
        flag_absen: j.flag_absen
      };
    });
  return { jamaah: jamaah, keluarga: [], rekap: full.rekap };
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

    // Validasi KK yang dipilih benar-benar ada
    var idKeluarga = d.id_keluarga;
    if (!d.is_new_keluarga) {
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
      writeRowAsText_(shKeluarga, shKeluarga.getLastRow() + 1,
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
    writeRowAsText_(shJamaah, foundRowIndex || shJamaah.getLastRow() + 1, row, [6]);
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

  var d = {
    id_jamaah: f.id_jamaah ? text(f.id_jamaah, 64) : null,
    is_new_keluarga: f.is_new_keluarga === true || f.is_new_keluarga === 'true',
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
    catatan: text(f.catatan, 500)
  };

  if (d.is_new_keluarga) {
    if (!d.nama_kk) errors.push("Nama Kepala Keluarga wajib diisi.");
    if (!d.alamat) errors.push("Alamat KK baru wajib diisi.");
    if (d.telepon && !/^[0-9+\-\s]{6,20}$/.test(d.telepon)) errors.push("No. telepon hanya boleh angka, spasi, + atau -.");
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
  if (!d.is_aktif || !d.flag_absen) errors.push("Penanda Aktif/Absen tidak valid.");
  if (!d.status_keberadaan) errors.push("Status keberadaan tidak valid.");
  if (d.status_nikah === "DUDA" && d.jenis_kelamin === "P") errors.push("Status DUDA hanya untuk laki-laki.");
  if (d.status_nikah === "JANDA" && d.jenis_kelamin === "L") errors.push("Status JANDA hanya untuk perempuan.");

  if (errors.length) throw new Error(errors.join(" "));
  return d;
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
      shJamaah.getRange(2, 1, shJamaah.getLastRow() - 1, shJamaah.getLastColumn()).clearContent();
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
