/**
 * Simulasi & uji backend Code.gs secara offline (Node.js, tanpa dependensi).
 * Jalankan:  node simulate_local.js
 * Keluar dengan kode 1 bila ada tes yang gagal.
 *
 * Catatan: semua nama di sini FIKTIF. Repo ini publik, jangan isi data jamaah asli.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Mock Google Apps Script services
// ---------------------------------------------------------------------------
class MockSheet {
  constructor(name, headers, rows) {
    this.name = name;
    this.rows = [headers, ...rows];
    this.formats = {}; // "row,col" -> number format
  }
  getName() { return this.name; }
  getLastRow() {
    let last = this.rows.length;
    while (last > 0 && (!this.rows[last - 1] || this.rows[last - 1].every(v => v === '' || v === undefined))) last--;
    return last;
  }
  getLastColumn() { return this.rows[0] ? this.rows[0].length : 0; }
  getRange(row, col, numRows = 1, numCols = 1) {
    const self = this;
    const r0 = row - 1, c0 = col - 1;
    const range = {
      getValues() {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const src = self.rows[r0 + r] || [];
          const line = [];
          for (let c = 0; c < numCols; c++) line.push(src[c0 + c] !== undefined ? src[c0 + c] : '');
          out.push(line);
        }
        return out;
      },
      setValues(values) {
        if (values.length !== numRows || values[0].length !== numCols) {
          throw new Error(`setValues dimensi tidak cocok: data ${values.length}x${values[0].length}, range ${numRows}x${numCols}`);
        }
        for (let r = 0; r < numRows; r++) {
          if (!self.rows[r0 + r]) self.rows[r0 + r] = [];
          for (let c = 0; c < numCols; c++) self.rows[r0 + r][c0 + c] = values[r][c];
        }
        return range;
      },
      setNumberFormat(fmt) {
        for (let r = 0; r < numRows; r++) for (let c = 0; c < numCols; c++) self.formats[`${row + r},${col + c}`] = fmt;
        return range;
      },
      setNumberFormats(fmts) {
        for (let r = 0; r < numRows; r++) for (let c = 0; c < numCols; c++) self.formats[`${row + r},${col + c}`] = fmts[r][c];
        return range;
      },
      clearContent() {
        for (let r = 0; r < numRows; r++) {
          const line = self.rows[r0 + r];
          if (line) for (let c = 0; c < numCols; c++) line[c0 + c] = '';
        }
        return range;
      }
    };
    return range;
  }
  appendRow(values) { this.rows.push(values.slice()); return this; }
  copyTo(ss) {
    const copy = new MockSheet(this.name + ' (copy)', this.rows[0].slice(), this.rows.slice(1).map(r => r.slice()));
    copy.setName = (n) => { delete ss.sheets[copy.name]; copy.name = n; ss.sheets[n] = copy; return copy; };
    ss.sheets[copy.name] = copy;
    return copy;
  }
}

const HEADER_KELUARGA = ["ID Keluarga", "Nama KK", "Alamat", "No Telepon"];
const HEADER_JAMAAH = ["ID Jamaah", "ID Keluarga", "Hubungan Keluarga", "Nama Lengkap", "Nama Absen", "Jenis Kelamin",
  "Tahun Lahir", "Status Nikah", "Status Keaktifan", "Flag Absen", "Status Keberadaan", "Catatan"];

class MockSpreadsheet {
  constructor() {
    this.sheets = {
      Keluarga: new MockSheet("Keluarga", HEADER_KELUARGA, [
        ["KK-A", "Bapak Contoh Satu", "Alamat Contoh RT 01", "080000000001"],
        ["KK-B", "Bapak Contoh Dua", "Alamat Contoh RT 02", "080000000002"],
        ["KK-C", "Bapak Contoh Tiga", "Alamat Contoh RT 03", "080000000003"]
      ]),
      Jamaah: new MockSheet("Jamaah", HEADER_JAMAAH, [
        ["JM-1", "KK-A", "A", "Bapak Contoh Satu", "Contoh Satu", "L", 1956, "MENIKAH", "Y", "Y", "Menetap", "catatan rahasia"],
        ["JM-2", "KK-A", "B", "Ibu Contoh Satu", "Ibu Satu", "P", 1968, "MENIKAH", "Y", "Y", "Menetap", ""],
        ["JM-3", "KK-B", "A", "Bapak Contoh Dua", "Contoh Dua", "L", 1997, "MENIKAH", "Y", "Y", "Menetap", ""],
        ["JM-4", "KK-B", "B", "Ibu Contoh Dua", "Ibu Dua", "P", 1999, "MENIKAH", "Y", "Y", "Menetap", ""],
        ["JM-5", "KK-B", "C", "Anak Contoh Dua", "Anak Dua", "L", 2025, "BELUM", "Y", "N", "Menetap", ""],
        ["JM-6", "KK-C", "A", "Bapak Contoh Tiga", "Contoh Tiga", "L", 1967, "MENIKAH", "Y", "Y", "Menetap", ""],
        ["JM-7", "KK-C", "B", "Ibu Contoh Tiga", "Ibu Tiga", "P", 1964, "MENIKAH", "Y", "Y", "Menetap", ""],
        ["JM-8", "KK-B", "C", "Anak Mondok Dua", "Anak Mondok", "P", 2010, "BELUM", "N", "N", "Mondok", ""],
        ["JM-9", "KK-C", "C", "Anak Tanpa Tahun", "Tanpa Tahun", "L", "", "BELUM", "Y", "Y", "Menetap", ""]
      ])
    };
  }
  getSheetByName(name) { return this.sheets[name] || null; }
  insertSheet(name) { if (!this.sheets[name]) this.sheets[name] = new MockSheet(name, [], []); return this.sheets[name]; }
}

function createSandbox() {
  let ss = new MockSpreadsheet();
  const cacheStore = {};
  const props = { ADMIN_PIN: '246810', VIEWER_PIN: '135790' };
  const session = { active: '', owner: 'pemilik@example.com' };

  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      openByUrl: () => ss,
      flush: () => {}
    },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => (k in cacheStore ? cacheStore[k] : null),
        put: (k, v) => { cacheStore[k] = String(v); },
        remove: (k) => { delete cacheStore[k]; }
      })
    },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) })
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} })
    },
    Session: {
      getScriptTimeZone: () => 'Asia/Jakarta',
      getActiveUser: () => ({ getEmail: () => session.active }),
      getEffectiveUser: () => ({ getEmail: () => session.owner })
    },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      sleep: () => {},
      formatDate: (d) => d.toISOString().slice(0, 16).replace(/[-:T]/g, '')
    },
    HtmlService: {},
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({ getContent: () => text, setMimeType() { return this; } })
    },
    Logger: { log: () => {} },
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8'), sandbox);
  return {
    gs: sandbox,
    get ss() { return ss; },
    resetSheets() { ss = new MockSpreadsheet(); },
    cacheStore, props, session
  };
}

// ---------------------------------------------------------------------------
// Mini test runner
// ---------------------------------------------------------------------------
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`\x1b[32m✔\x1b[0m ${name}`); }
  catch (e) { failed++; console.log(`\x1b[31m✘ ${name}\x1b[0m\n    ${e.message}`); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || 'nilai berbeda'}: diharapkan ${JSON.stringify(b)}, didapat ${JSON.stringify(a)}`); }

const THIS_YEAR = new Date().getFullYear();
const validJamaah = (over = {}) => Object.assign({
  id_keluarga: "KK-A", is_new_keluarga: false, hubungan_keluarga: "C",
  nama_lengkap: "Anak Contoh Baru", nama_absen: "Anak Baru", jenis_kelamin: "L",
  tahun_lahir: 2003, status_nikah: "BELUM", is_aktif: "Y", flag_absen: "Y",
  status_keberadaan: "Menetap", catatan: ""
}, over);

console.log("================= UJI BACKEND Code.gs (LOCAL) =================\n");

// --- Autentikasi ---------------------------------------------------------
test("getSensusData tanpa token ditolak (authError)", () => {
  const { gs } = createSandbox();
  const r = gs.getSensusData();
  eq(r.success, false); eq(r.authError, true);
});

test("saveSensusData tanpa token ditolak dan tidak menulis apa pun", () => {
  const env = createSandbox();
  const before = env.ss.sheets.Jamaah.getLastRow();
  const r = env.gs.saveSensusData(undefined, validJamaah());
  eq(r.authError, true);
  eq(env.ss.sheets.Jamaah.getLastRow(), before, "jumlah baris");
});

test("PIN salah ditolak; setelah 5x salah login terkunci (PIN benar pun ditolak)", () => {
  const { gs } = createSandbox();
  for (let i = 0; i < 5; i++) eq(gs.login('000000', 'index').success, false);
  const r = gs.login('246810', 'index');
  eq(r.success, false); assert(/Terlalu banyak/.test(r.message), r.message);
});

test("ADMIN_PIN belum diatur / terlalu pendek -> login ditolak dengan pesan jelas", () => {
  const env = createSandbox();
  env.props.ADMIN_PIN = '123';
  const r = env.gs.login('123', 'index');
  eq(r.success, false); assert(/ADMIN_PIN/.test(r.message), r.message);
});

test("PIN viewer tidak bisa masuk halaman admin, tapi bisa di halaman view", () => {
  const { gs } = createSandbox();
  eq(gs.login('135790', 'index').success, false);
  const r = gs.login('135790', 'view');
  eq(r.success, true); eq(r.role, 'VIEWER');
});

test("Logout menghapus sesi", () => {
  const { gs } = createSandbox();
  const t = gs.login('246810', 'index').token;
  eq(gs.getSensusData(t).success, true);
  gs.logout(t);
  eq(gs.getSensusData(t).authError, true);
});

// --- JSON API (doPost) untuk GitHub Pages ----------------------------------
const post = (gs, body) => JSON.parse(gs.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).getContent());

test("doPost: login, ambil data, dan simpan lewat API JSON", () => {
  const env = createSandbox();
  const lg = post(env.gs, { action: 'login', args: ['246810', 'index'] });
  eq(lg.success, true);
  const data = post(env.gs, { action: 'getSensusData', args: [lg.token] });
  eq(data.success, true); eq(data.data.jamaah.length, 9);
  const sv = post(env.gs, { action: 'saveSensusData', args: [lg.token, validJamaah()] });
  eq(sv.success, true, sv.message);
});

test("doPost: tanpa token ditolak (authError)", () => {
  const { gs } = createSandbox();
  eq(post(gs, { action: 'getSensusData', args: [] }).authError, true);
});

test("doPost: fungsi di luar daftar (migrasi, internal) tidak bisa dipanggil", () => {
  const env = createSandbox();
  env.session.active = env.session.owner; // bahkan bila pemilik
  ['jalankanMigrasiSensus', 'readSensus_', 'toString', '__proto__', 'constructor'].forEach(a => {
    const r = post(env.gs, { action: a, args: [] });
    eq(r.success, false, a); assert(/tidak dikenal/.test(r.message), r.message);
  });
  eq(env.ss.sheets.Jamaah.getLastRow(), 10, "data harus utuh");
});

test("doPost: body rusak tidak membuat server error", () => {
  const { gs } = createSandbox();
  const r = post(gs, '{bukan json');
  eq(r.success, false);
});

// --- Pembacaan data & privasi -----------------------------------------------
test("ADMIN menerima data lengkap (alamat, telepon, catatan)", () => {
  const { gs } = createSandbox();
  const t = gs.login('246810', 'index').token;
  const r = gs.getSensusData(t);
  eq(r.role, 'ADMIN');
  eq(r.data.keluarga.length, 3);
  eq(r.data.jamaah.length, 9);
  eq(r.data.keluarga[0].telepon, '080000000001');
  eq(r.data.jamaah[0].catatan, 'catatan rahasia');
});

test("VIEWER hanya menerima jamaah aktif & absen, tanpa alamat/telepon/catatan/ID", () => {
  const { gs } = createSandbox();
  const t = gs.login('135790', 'view').token;
  const r = gs.getSensusData(t);
  eq(r.role, 'VIEWER');
  eq(r.data.keluarga.length, 0, "keluarga untuk viewer");
  assert(r.data.jamaah.every(j => j.is_aktif === 'Y' && j.flag_absen === 'Y'), "ada jamaah non-aktif/non-absen");
  const forbidden = ['alamat', 'telepon', 'catatan', 'id_jamaah', 'id_keluarga', 'tahun_lahir', 'status_keberadaan'];
  r.data.jamaah.forEach(j => forbidden.forEach(f => assert(!(f in j), `field ${f} bocor ke viewer`)));
  eq(r.data.jamaah.length, 7);
});

test("VIEWER tidak boleh menyimpan data", () => {
  const { gs } = createSandbox();
  const t = gs.login('135790', 'view').token;
  eq(gs.saveSensusData(t, validJamaah()).authError, true);
});

test("Rekap: total aktif, KK aktif, lansia, dan tahun lahir kosong tidak jadi BALITA", () => {
  const { gs } = createSandbox();
  const t = gs.login('246810', 'index').token;
  const r = gs.getSensusData(t).data;
  eq(r.rekap.total, 8, "total aktif");
  eq(r.rekap.kkCount, 3, "KK aktif");
  const lansiaExpected = [1956, 1968, 1967, 1964].filter(y => THIS_YEAR - y >= 57).length;
  eq(r.rekap.lansia, lansiaExpected, "lansia");
  const tanpa = r.jamaah.find(j => j.id_jamaah === 'JM-9');
  eq(tanpa.umur, null); eq(tanpa.kategori_usia, 'Tanpa Tahun Lahir');
  eq(r.rekap.tanpaTahunLahir, 1);
});

test("Rule engine: batas kategori usia", () => {
  const { gs } = createSandbox();
  const cases = [[5, 'BALITA-PAUD'], [6, 'Caberawit'], [12, 'Caberawit'], [13, 'Pra Remaja (SMP)'],
    [15, 'Pra Remaja (SMP)'], [16, 'Remaja (SMA)'], [17, 'Remaja (SMA)'], [18, 'Usia (Pra) Menikah']];
  cases.forEach(([umur, kat]) => eq(gs.dapatkanKategoriUsia(THIS_YEAR - umur, 'BELUM'), kat, `umur ${umur}`));
  eq(gs.dapatkanKategoriUsia(THIS_YEAR - 20, 'JANDA'), 'Dewasa Menikah');
});

// --- Penyimpanan & validasi -------------------------------------------------
test("Simpan jamaah baru valid", () => {
  const env = createSandbox();
  const t = env.gs.login('246810', 'index').token;
  const r = env.gs.saveSensusData(t, validJamaah());
  eq(r.success, true, r.message);
  const saved = env.gs.getSensusData(t).data.jamaah.find(j => j.nama_lengkap === 'Anak Contoh Baru');
  assert(saved, "data tidak ditemukan");
  eq(saved.id_keluarga, 'KK-A'); eq(saved.kategori_usia, 'Usia (Pra) Menikah');
});

const invalidCases = [
  ["tanpa KK", { id_keluarga: "" }, /Pilih Keluarga/],
  ["KK tidak ada di sheet", { id_keluarga: "KK-TIDAK-ADA" }, /tidak ditemukan/],
  ["tahun lahir kosong", { tahun_lahir: NaN }, /Tahun lahir/],
  ["tahun lahir di masa depan", { tahun_lahir: THIS_YEAR + 1 }, /Tahun lahir/],
  ["jenis kelamin tidak valid", { jenis_kelamin: "X" }, /Jenis kelamin/],
  ["nama kosong", { nama_lengkap: "   " }, /Nama lengkap/],
  ["DUDA untuk perempuan", { jenis_kelamin: "P", status_nikah: "DUDA" }, /DUDA/],
  ["KK baru tanpa alamat", { is_new_keluarga: true, id_keluarga: "NEW", nama_kk: "KK Baru", alamat: "" }, /Alamat/]
];
invalidCases.forEach(([name, over, re]) => {
  test(`Validasi menolak: ${name}`, () => {
    const env = createSandbox();
    const t = env.gs.login('246810', 'index').token;
    const beforeJ = env.ss.sheets.Jamaah.getLastRow(), beforeK = env.ss.sheets.Keluarga.getLastRow();
    const r = env.gs.saveSensusData(t, validJamaah(over));
    eq(r.success, false); assert(re.test(r.message), r.message);
    eq(env.ss.sheets.Jamaah.getLastRow(), beforeJ, "baris jamaah bertambah");
    eq(env.ss.sheets.Keluarga.getLastRow(), beforeK, "baris keluarga bertambah");
  });
});

test("KK baru: telepon & nama disimpan sebagai teks ('@'), tahun lahir sebagai angka", () => {
  const env = createSandbox();
  const t = env.gs.login('246810', 'index').token;
  const r = env.gs.saveSensusData(t, validJamaah({
    is_new_keluarga: true, id_keluarga: "NEW", nama_kk: "=HYPERLINK(\"http://x\")", alamat: "Alamat Baru", telepon: "081234567890",
    hubungan_keluarga: "A", nama_lengkap: "Kepala Baru", status_nikah: "MENIKAH", tahun_lahir: 1990
  }));
  eq(r.success, true, r.message);
  const kSheet = env.ss.sheets.Keluarga, jSheet = env.ss.sheets.Jamaah;
  const kRow = kSheet.getLastRow(), jRow = jSheet.getLastRow();
  eq(kSheet.formats[`${kRow},4`], '@', "format telepon");
  eq(kSheet.formats[`${kRow},2`], '@', "format nama KK (anti formula)");
  eq(jSheet.formats[`${jRow},7`], '0', "format tahun lahir");
  eq(kSheet.rows[kRow - 1][3], '081234567890');
  eq(jSheet.rows[jRow - 1][1], kSheet.rows[kRow - 1][0], "jamaah tertaut ke KK baru");
});

test("Edit jamaah: baris yang sama diperbarui, jumlah baris tetap", () => {
  const env = createSandbox();
  const t = env.gs.login('246810', 'index').token;
  const before = env.ss.sheets.Jamaah.getLastRow();
  const r = env.gs.saveSensusData(t, validJamaah({ id_jamaah: "JM-5", id_keluarga: "KK-B", nama_lengkap: "Anak Dua Diedit", tahun_lahir: 2024 }));
  eq(r.success, true, r.message);
  eq(env.ss.sheets.Jamaah.getLastRow(), before);
  eq(env.ss.sheets.Jamaah.rows[5][3], "Anak Dua Diedit");
});

test("Edit jamaah dengan ID tidak ada: gagal dan tidak membuat KK yatim", () => {
  const env = createSandbox();
  const t = env.gs.login('246810', 'index').token;
  const beforeK = env.ss.sheets.Keluarga.getLastRow();
  const r = env.gs.saveSensusData(t, validJamaah({ id_jamaah: "JM-404", is_new_keluarga: true, id_keluarga: "NEW", nama_kk: "X", alamat: "Y" }));
  eq(r.success, false);
  eq(env.ss.sheets.Keluarga.getLastRow(), beforeK);
});

// --- Migrasi ----------------------------------------------------------------
test("Migrasi ditolak bila dipanggil dari web app (bukan pemilik di editor)", () => {
  const env = createSandbox();
  env.session.active = '';
  const r = env.gs.jalankanMigrasiSensus();
  eq(r.success, false); assert(/pemilik/.test(r.message), r.message);
  eq(env.ss.sheets.Jamaah.getLastRow(), 10, "data jamaah harus utuh");
});

test("Migrasi dengan Sensus_Asal kosong tidak menghapus data", () => {
  const env = createSandbox();
  env.session.active = env.session.owner;
  env.ss.sheets.Sensus_Asal = new MockSheet("Sensus_Asal", ["No"], []);
  const r = env.gs.jalankanMigrasiSensus();
  eq(r.success, false);
  eq(env.ss.sheets.Jamaah.getLastRow(), 10, "data jamaah harus utuh");
});

test("Migrasi sukses membuat backup lalu memecah data ke Keluarga & Jamaah", () => {
  const env = createSandbox();
  env.session.active = env.session.owner;
  env.ss.sheets.Sensus_Asal = new MockSheet("Sensus_Asal", ["No"], [
    [1, "Y", "Kepala Satu", "", "A", "L", 1970, "", "Y", "", "MENIKAH", ""],
    [2, "Y", "Istri Satu", "", "B", "P", 1972, "", "Y", "", "MENIKAH", ""],
    [3, "Y", "Anak Satu", "", "C", "L", 2012, "", "Mondok", "", "", ""],
    [4, "N", "Kepala Dua", "", "A", "L", 1980, "", "N", "", "MENIKAH", ""]
  ]);
  const r = env.gs.jalankanMigrasiSensus();
  eq(r.success, true, r.message);
  assert(Object.keys(env.ss.sheets).some(n => n.startsWith('Backup_Jamaah_')), "backup jamaah tidak dibuat");
  eq(env.ss.sheets.Keluarga.getLastRow(), 3, "2 KK + header");
  eq(env.ss.sheets.Jamaah.getLastRow(), 5, "4 jiwa + header");
  const anak = env.ss.sheets.Jamaah.rows[3];
  eq(anak[10], "Mondok"); eq(anak[9], "N");
});

console.log(`\n================= ${passed} lulus, ${failed} gagal =================`);
process.exit(failed ? 1 : 0);
