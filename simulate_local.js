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
    this.rows = headers ? [headers.slice(), ...rows.map(r => r.slice())] : [];
    this.formats = {}; // "row,col" -> number format
  }
  getName() { return this.name; }
  getLastRow() {
    let last = this.rows.length;
    while (last > 0 && (!this.rows[last - 1] || this.rows[last - 1].every(v => v === '' || v === undefined))) last--;
    return last;
  }
  getLastColumn() { return this.rows[0] ? Math.max(...this.rows.map(r => (r || []).length)) : 0; }
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
  appendRow(values) { this.rows.splice(this.getLastRow(), 0, values.slice()); return this; }
  deleteRow(r) { this.rows.splice(r - 1, 1); return this; }
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
  insertSheet(name) { if (!this.sheets[name]) this.sheets[name] = new MockSheet(name, null, []); return this.sheets[name]; }
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

const CUSTOM_CFG = {
  labelMenikah: 'Sudah Menikah',
  kategori: [
    { nama: 'Anak', min: 0, max: 12 }, { nama: 'Remaja', min: 13, max: 20 },
    { nama: 'Dewasa', min: 21, max: 59 }, { nama: 'Lansia', min: 60, max: null, lansia: true }
  ]
};

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
  ['jalankanMigrasiSensus', 'readSensus_', 'archiveAndDeleteRows_', 'writeKategoriSheet_', 'toString', '__proto__', 'constructor'].forEach(a => {
    const r = post(env.gs, { action: a, args: [] });
    eq(r.success, false, a); assert(/tidak dikenal/.test(r.message), r.message);
  });
  eq(env.ss.sheets.Jamaah.getLastRow(), 10, "data harus utuh");
});

test("doPost: hapus & simpan pengaturan lewat API", () => {
  const env = createSandbox();
  const tok = post(env.gs, { action: 'login', args: ['246810', 'index'] }).token;
  eq(post(env.gs, { action: 'deleteJamaah', args: [tok, 'JM-5', 'single', 'Pindah domisili'] }).success, true);
  eq(post(env.gs, { action: 'saveKategoriConfig', args: [tok, CUSTOM_CFG] }).success, true);
  eq(post(env.gs, { action: 'deleteKeluarga', args: [tok, 'KK-C', 'Pindah domisili'] }).success, true);
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

test("VIEWER menerima seluruh jamaah (hanya-lihat), tanpa Perlu dibantu & ID asli", () => {
  const { gs } = createSandbox();
  const t = gs.login('135790', 'view').token;
  const r = gs.getSensusData(t);
  eq(r.role, 'VIEWER');
  eq(r.data.jamaah.length, 9, "semua jamaah, termasuk anak & tidak aktif");
  assert(r.data.jamaah.some(j => j.flag_absen === 'N'), "anak yang tidak wajib absen ikut");
  assert(r.data.jamaah.some(j => j.is_aktif === 'N'), "jamaah luar kota ikut");
  const forbidden = ['perlu_dibantu', 'id_jamaah', 'id_keluarga'];
  r.data.jamaah.forEach(j => forbidden.forEach(f => assert(!(f in j), `field ${f} bocor ke viewer`)));
  const kepala = r.data.jamaah.find(j => j.nama_lengkap === 'Bapak Contoh Satu');
  eq(kepala.alamat_kk, 'Alamat Contoh RT 01'); eq(kepala.catatan, 'catatan rahasia'); eq(kepala.kk_terdaftar, true);
  eq(r.data.keluarga.length, 0, "daftar keluarga (dengan ID) tidak dikirim");
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

test("Rule engine: batas kategori usia default (termasuk Lansia)", () => {
  const { gs } = createSandbox();
  const cases = [[5, 'BALITA-PAUD'], [6, 'Caberawit'], [12, 'Caberawit'], [13, 'Pra Remaja (SMP)'],
    [15, 'Pra Remaja (SMP)'], [16, 'Remaja (SMA)'], [17, 'Remaja (SMA)'], [18, 'Usia (Pra) Menikah'],
    [56, 'Usia (Pra) Menikah'], [57, 'Lansia'], [90, 'Lansia']];
  cases.forEach(([umur, kat]) => eq(gs.dapatkanKategoriUsia(THIS_YEAR - umur, 'BELUM'), kat, `umur ${umur}`));
  eq(gs.dapatkanKategoriUsia(THIS_YEAR - 20, 'JANDA'), 'Dewasa Menikah');
  eq(gs.dapatkanKategoriUsia(THIS_YEAR - 56, 'MENIKAH'), 'Dewasa Menikah');
  eq(gs.dapatkanKategoriUsia(THIS_YEAR - 57, 'MENIKAH'), 'Lansia', "Lansia diutamakan di atas status nikah");
  eq(gs.dapatkanKategoriUsia(THIS_YEAR - 70, 'JANDA'), 'Lansia');
  eq(gs.dapatkanKategoriUsia(null, 'MENIKAH'), 'Dewasa Menikah', "tanpa tahun lahir tetap ikut status nikah");
});

test("Rekap: Janda/Duda lansia dihitung di Lansia (sekali saja), total baris = total jiwa", () => {
  const env = createSandbox();
  const sh = env.ss.sheets.Jamaah;
  sh.rows.push(["JM-10", "KK-C", "D", "Nenek Janda", "Nenek", "P", THIS_YEAR - 75, "JANDA", "Y", "Y", "Menetap", ""]);
  sh.rows.push(["JM-11", "KK-C", "D", "Janda Muda", "Janda", "P", THIS_YEAR - 40, "JANDA", "Y", "Y", "Menetap", ""]);
  const t = env.gs.login('246810', 'index').token;
  const d = env.gs.getSensusData(t).data;
  eq(d.jamaah.find(j => j.id_jamaah === 'JM-10').kategori_usia, 'Lansia');
  eq(d.rekap.janda, 1, "hanya janda non-lansia");
  const lansia = d.rekap.detail['Lansia'];
  const lansiaExpected = d.jamaah.filter(j => j.is_aktif === 'Y' && j.umur !== null && j.umur >= 57).length;
  eq(lansia.L + lansia.P, lansiaExpected, "baris Lansia = semua jamaah aktif ≥57");
  eq(d.rekap.lansia, lansiaExpected, "kartu Lansia sama dengan baris Lansia");
  const rows = Object.values(d.rekap.detail).reduce((a, x) => a + x.L + x.P, 0) + d.rekap.duda + d.rekap.janda;
  eq(rows, d.rekap.total - d.rekap.tanpaTahunLahir, "tiap jiwa dihitung sekali");
});

// --- Pengaturan kategori ----------------------------------------------------

test("Sheet Pengaturan_Kategori dibuat otomatis dengan nilai default", () => {
  const env = createSandbox();
  const t = env.gs.login('246810', 'index').token;
  const r = env.gs.getSensusData(t);
  assert(env.ss.sheets.Pengaturan_Kategori, "sheet tidak dibuat");
  eq(env.ss.sheets.Pengaturan_Kategori.getLastRow(), 8, "header + 6 kategori + label menikah");
  eq(r.data.rekap.kategoriOrder.join('|'), 'BALITA-PAUD|Caberawit|Pra Remaja (SMP)|Remaja (SMA)|Usia (Pra) Menikah|Lansia|Dewasa Menikah');
  eq(r.data.rekap.batasLansia, 57);
});

test("Simpan pengaturan kategori: rekap & batas lansia ikut berubah", () => {
  const env = createSandbox();
  const t = env.gs.login('246810', 'index').token;
  const s = env.gs.saveKategoriConfig(t, CUSTOM_CFG);
  eq(s.success, true, s.message);
  const r = env.gs.getSensusData(t).data;
  eq(r.rekap.kategoriOrder.join('|'), 'Anak|Remaja|Dewasa|Lansia|Sudah Menikah');
  eq(r.rekap.batasLansia, 60);
  const lansiaExpected = [1956, 1968, 1967, 1964].filter(y => THIS_YEAR - y >= 60).length;
  eq(r.rekap.lansia, lansiaExpected, "lansia dengan batas 60");
  eq(r.jamaah.find(j => j.id_jamaah === 'JM-1').kategori_usia, 'Lansia', "menikah umur ≥60 -> Lansia");
  eq(r.jamaah.find(j => j.id_jamaah === 'JM-3').kategori_usia, 'Sudah Menikah');
  eq(r.jamaah.find(j => j.id_jamaah === 'JM-5').kategori_usia, 'Anak');
});

const badCfgs = [
  ["tidak mulai dari 0", { labelMenikah: 'M', kategori: [{ nama: 'A', min: 1, max: null }] }, /mulai dari umur 0/],
  ["rentang bolong", { labelMenikah: 'M', kategori: [{ nama: 'A', min: 0, max: 10 }, { nama: 'B', min: 12, max: null }] }, /bersambung/],
  ["rentang tumpang tindih", { labelMenikah: 'M', kategori: [{ nama: 'A', min: 0, max: 10 }, { nama: 'B', min: 8, max: null }] }, /bersambung/],
  ["terakhir punya batas atas", { labelMenikah: 'M', kategori: [{ nama: 'A', min: 0, max: 10 }] }, /tanpa batas atas/],
  ["nama ganda", { labelMenikah: 'M', kategori: [{ nama: 'A', min: 0, max: 10 }, { nama: 'a', min: 11, max: null }] }, /lebih dari sekali/],
  ["dua penanda lansia", { labelMenikah: 'M', kategori: [{ nama: 'A', min: 0, max: 10, lansia: true }, { nama: 'B', min: 11, max: null, lansia: true }] }, /Lansia hanya/],
  ["nama sistem", { labelMenikah: 'M', kategori: [{ nama: 'Janda', min: 0, max: null }] }, /dipakai sistem/],
  ["label menikah kosong", { labelMenikah: ' ', kategori: [{ nama: 'A', min: 0, max: null }] }, /sudah menikah/]
];
badCfgs.forEach(([name, cfg, re]) => {
  test(`Pengaturan kategori ditolak: ${name}`, () => {
    const env = createSandbox();
    const t = env.gs.login('246810', 'index').token;
    env.gs.getSensusData(t);
    const before = JSON.stringify(env.ss.sheets.Pengaturan_Kategori.rows);
    const r = env.gs.saveKategoriConfig(t, cfg);
    eq(r.success, false); assert(re.test(r.message), r.message);
    eq(JSON.stringify(env.ss.sheets.Pengaturan_Kategori.rows), before, "sheet tidak boleh berubah");
  });
});

test("Pengaturan kategori: VIEWER tidak boleh menyimpan", () => {
  const { gs } = createSandbox();
  const t = gs.login('135790', 'view').token;
  eq(gs.saveKategoriConfig(t, CUSTOM_CFG).authError, true);
});

test("Sheet Pengaturan_Kategori rusak (diedit manual) -> memakai default, aplikasi tetap jalan", () => {
  const env = createSandbox();
  const t = env.gs.login('246810', 'index').token;
  env.gs.getSensusData(t);
  env.ss.sheets.Pengaturan_Kategori.rows[2][2] = 99; // Caberawit mulai 99 -> tidak bersambung
  const r = env.gs.getSensusData(t);
  eq(r.success, true);
  assert(r.data.kategoriConfig.invalid, "harus menandai konfigurasi tidak valid");
  eq(r.data.rekap.kategoriOrder[0], 'BALITA-PAUD');
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

test("No. telepon jamaah & perlu dibantu tersimpan; telepon sebagai teks", () => {
  const env = createSandbox();
  const t = env.gs.login('246810', 'index').token;
  const r = env.gs.saveSensusData(t, validJamaah({ no_telepon: '081299990000', perlu_dibantu: 'Y' }));
  eq(r.success, true, r.message);
  const sh = env.ss.sheets.Jamaah, row = sh.getLastRow();
  eq(sh.rows[row - 1][12], '081299990000'); eq(sh.formats[`${row},13`], '@');
  eq(sh.rows[row - 1][13], 'Y');
  eq(sh.rows[0][12], 'No Telepon', "header kolom baru ditambahkan");
  const d = env.gs.getSensusData(t).data;
  eq(d.rekap.perluDibantu, 1);
  const saved = d.jamaah.find(j => j.nama_lengkap === 'Anak Contoh Baru');
  eq(saved.no_telepon, '081299990000'); eq(saved.perlu_dibantu, 'Y');
});

test("VIEWER menerima no. telepon, tapi tidak menerima penanda perlu dibantu", () => {
  const env = createSandbox();
  const ta = env.gs.login('246810', 'index').token;
  env.gs.saveSensusData(ta, validJamaah({ id_jamaah: 'JM-3', id_keluarga: 'KK-B', hubungan_keluarga: 'A', nama_lengkap: 'Bapak Contoh Dua', status_nikah: 'MENIKAH', tahun_lahir: 1997, no_telepon: '081100002222', perlu_dibantu: 'Y' }));
  const tv = env.gs.login('135790', 'view').token;
  const d = env.gs.getSensusData(tv).data;
  const j = d.jamaah.find(x => x.nama_lengkap === 'Bapak Contoh Dua');
  eq(j.no_telepon, '081100002222');
  assert(!('perlu_dibantu' in j), "perlu_dibantu bocor ke viewer");
  assert(!('perluDibantu' in d.rekap), "jumlah perlu dibantu bocor ke viewer");
  assert(typeof j.grup_kk === 'number' && j.grup_kk > 0, "grup_kk untuk pengelompokan");
});

test("Validasi menolak telepon jamaah berisi huruf", () => {
  const env = createSandbox();
  const t = env.gs.login('246810', 'index').token;
  const r = env.gs.saveSensusData(t, validJamaah({ no_telepon: 'telp 0812' }));
  eq(r.success, false); assert(/telepon jamaah/.test(r.message), r.message);
});

// --- Kolom tambahan milik pengguna tidak boleh tertimpa ----------------------
function withUmurColumn(env) {
  // Sheet asli pengguna: kolom M berisi "Umur" (mis. rumus), diisi juga di baris kosong di bawah data
  const sh = env.ss.sheets.Jamaah;
  sh.rows[0][12] = 'Umur';
  for (let r = 1; r < sh.rows.length; r++) sh.rows[r][12] = sh.rows[r][6] ? THIS_YEAR - sh.rows[r][6] : '';
  for (let k = 0; k < 5; k++) sh.rows.push(['', '', '', '', '', '', '', '', '', '', '', '', '#N/A']);
  return sh;
}

test("Kolom 'Umur' milik pengguna di kolom M tidak ditimpa; kolom baru ditambah di N & O", () => {
  const env = createSandbox();
  const sh = withUmurColumn(env);
  const t = env.gs.login('246810', 'index').token;
  const d = env.gs.getSensusData(t).data;
  eq(sh.rows[0][12], 'Umur', "header M tetap");
  eq(sh.rows[0][13], 'No Telepon'); eq(sh.rows[0][14], 'Perlu Dibantu');
  assert(d.jamaah.every(j => j.no_telepon === ''), "umur tidak boleh terbaca sebagai telepon");
  eq((d.warnings || []).length, 0);
});

test("Simpan dengan kolom Umur: telepon masuk kolom N, umur di M tidak tersentuh, baris baru tepat setelah data", () => {
  const env = createSandbox();
  const sh = withUmurColumn(env);
  const t = env.gs.login('246810', 'index').token;
  const umurBefore = sh.rows[1][12];
  eq(env.gs.saveSensusData(t, validJamaah({ id_jamaah: 'JM-1', id_keluarga: 'KK-A', hubungan_keluarga: 'A', nama_lengkap: 'Bapak Contoh Satu', status_nikah: 'MENIKAH', tahun_lahir: 1956, no_telepon: '081234567890', perlu_dibantu: 'Y' })).success, true);
  eq(sh.rows[1][12], umurBefore, "kolom Umur baris JM-1");
  eq(sh.rows[1][13], '081234567890'); eq(sh.rows[1][14], 'Y');
  const r = env.gs.saveSensusData(t, validJamaah());
  eq(r.success, true, r.message);
  eq(sh.rows[10][0].startsWith('JM-'), true, "baris baru harus di baris 11 (setelah 9 data), bukan setelah baris rumus");
  eq(sh.rows[10][3], 'Anak Contoh Baru');
});

test("Kolom 'No Telepon' berisi angka umur -> tidak ditampilkan & admin diberi peringatan", () => {
  const env = createSandbox();
  const sh = env.ss.sheets.Jamaah;
  sh.rows[0][12] = 'No Telepon'; sh.rows[0][13] = 'Perlu Dibantu';
  sh.rows[1][12] = 70; sh.rows[2][12] = 58; sh.rows[3][12] = '081234567890';
  const t = env.gs.login('246810', 'index').token;
  const d = env.gs.getSensusData(t).data;
  eq(d.jamaah.find(j => j.id_jamaah === 'JM-1').no_telepon, '');
  eq(d.jamaah.find(j => j.id_jamaah === 'JM-3').no_telepon, '081234567890');
  eq(d.warnings.length, 1); assert(/2 isian/.test(d.warnings[0]) && /kolom M/.test(d.warnings[0]), d.warnings[0]);
  const tv = env.gs.login('135790', 'view').token;
  assert(!('warnings' in env.gs.getSensusData(tv).data), "peringatan tidak untuk viewer");
});

test("Hapus dengan kolom Umur: arsip menyalin semua kolom", () => {
  const env = createSandbox();
  withUmurColumn(env);
  const t = env.gs.login('246810', 'index').token;
  env.gs.getSensusData(t);
  eq(env.gs.deleteJamaah(t, 'JM-2', 'single', 'Pindah domisili').success, true);
  const arsip = env.ss.sheets.Arsip_Jamaah;
  eq(arsip.rows[0][14], 'Umur'); eq(arsip.rows[1][2], 'JM-2'); eq(arsip.rows[1][14], THIS_YEAR - 1968);
});

// --- Jamaah mandiri / perantau (tanpa KK) ---------------------------------
function withMandiri(env) {
  const sh = env.ss.sheets.Jamaah;
  sh.rows.push(["JM-M1", "", "A", "Perantau Satu", "Perantau", "L", 2000, "BELUM", "Y", "Y", "Menetap", ""]);
  sh.rows.push(["JM-M2", "", "A", "Perantau Dua", "Perantau 2", "P", 2001, "BELUM", "Y", "Y", "Menetap", ""]);
  return sh;
}

test("Mandiri: terbaca sebagai 'Tanpa KK', dihitung jiwa tapi tidak dihitung KK", () => {
  const env = createSandbox();
  withMandiri(env);
  const t = env.gs.login('246810', 'index').token;
  const d = env.gs.getSensusData(t).data;
  const m = d.jamaah.find(j => j.id_jamaah === 'JM-M1');
  eq(m.tanpa_kk, true); eq(m.nama_kk, 'Tanpa KK (mandiri/perantau)');
  eq(d.rekap.kkCount, 3, "jumlah KK tidak bertambah");
  eq(d.rekap.total, 10, "tetap dihitung sebagai jiwa");
});

test("Mandiri: edit tersimpan tanpa KK (bug: dulu ditolak 'tidak terdaftar di KK')", () => {
  const env = createSandbox();
  const sh = withMandiri(env);
  const t = env.gs.login('246810', 'index').token;
  const r = env.gs.saveSensusData(t, validJamaah({ id_jamaah: 'JM-M1', id_keluarga: '', tanpa_kk: true, hubungan_keluarga: 'A', nama_lengkap: 'Perantau Satu Diedit', tahun_lahir: 2000 }));
  eq(r.success, true, r.message);
  const row = sh.rows.find(x => x[0] === 'JM-M1');
  eq(row[1], '', "ID Keluarga tetap kosong"); eq(row[3], 'Perantau Satu Diedit');
});

test("Mandiri: tambah jamaah baru tanpa KK", () => {
  const env = createSandbox();
  const t = env.gs.login('246810', 'index').token;
  const beforeK = env.ss.sheets.Keluarga.getLastRow();
  const r = env.gs.saveSensusData(t, validJamaah({ id_keluarga: '', tanpa_kk: true, nama_lengkap: 'Perantau Baru' }));
  eq(r.success, true, r.message);
  eq(env.ss.sheets.Keluarga.getLastRow(), beforeK, "tidak membuat KK");
  eq(env.ss.sheets.Jamaah.rows.find(x => x[3] === 'Perantau Baru')[1], '');
});

test("Tanpa penanda tanpa_kk, KK kosong tetap ditolak (mencegah lupa pilih KK)", () => {
  const env = createSandbox();
  const t = env.gs.login('246810', 'index').token;
  const r = env.gs.saveSensusData(t, validJamaah({ id_keluarga: '' }));
  eq(r.success, false); assert(/Pilih Keluarga/.test(r.message), r.message);
});

test("Mandiri: 'hapus seluruh KK' ditolak supaya tidak menghapus semua jamaah mandiri", () => {
  const env = createSandbox();
  const sh = withMandiri(env);
  const t = env.gs.login('246810', 'index').token;
  const r = env.gs.deleteJamaah(t, 'JM-M1', 'kk', 'Pindah domisili');
  eq(r.success, false); assert(/hapus per orang/.test(r.message), r.message);
  eq(sh.rows.filter(x => String(x[0]).startsWith('JM-M')).length, 2, "tidak ada yang terhapus");
  eq(env.gs.deleteJamaah(t, 'JM-M1', 'single', 'Pindah domisili').success, true);
  eq(sh.rows.filter(x => String(x[0]).startsWith('JM-M')).length, 1);
});

test("Mandiri di halaman pengurus: tanpa ID asli, grup_kk 0", () => {
  const env = createSandbox();
  withMandiri(env);
  const tv = env.gs.login('135790', 'view').token;
  const j = env.gs.getSensusData(tv).data.jamaah.find(x => x.nama_lengkap === 'Perantau Satu');
  eq(j.grup_kk, 0); eq(j.nama_kk, 'Tanpa KK (mandiri/perantau)');
});

// --- Hapus ------------------------------------------------------------------
test("Hapus jamaah (single): hanya baris itu, dipindah ke Arsip_Jamaah", () => {
  const env = createSandbox();
  const t = env.gs.login('246810', 'index').token;
  const r = env.gs.deleteJamaah(t, 'JM-5', 'single', 'Meninggal dunia');
  eq(r.success, true, r.message);
  eq(env.ss.sheets.Jamaah.getLastRow(), 9);
  assert(!env.ss.sheets.Jamaah.rows.some(x => x[0] === 'JM-5'), "JM-5 masih ada");
  const arsip = env.ss.sheets.Arsip_Jamaah;
  eq(arsip.rows[0][0], 'Waktu Hapus'); eq(arsip.rows[1][2], 'JM-5'); eq(arsip.rows[1][1], 'Meninggal dunia');
  eq(env.ss.sheets.Keluarga.getLastRow(), 4, "KK tidak ikut terhapus");
});

test("Hapus kepala keluarga saja (single): KK & anggota lain tetap", () => {
  const env = createSandbox();
  const t = env.gs.login('246810', 'index').token;
  eq(env.gs.deleteJamaah(t, 'JM-3', 'single', 'Pindah domisili').success, true);
  eq(env.ss.sheets.Jamaah.rows.filter(x => x[1] === 'KK-B').length, 3);
  eq(env.ss.sheets.Keluarga.getLastRow(), 4);
});

test("Hapus seluruh KK lewat kepala keluarga (mode kk): semua anggota + KK ke arsip", () => {
  const env = createSandbox();
  const t = env.gs.login('246810', 'index').token;
  const r = env.gs.deleteJamaah(t, 'JM-3', 'kk', 'Satu keluarga pindah kota');
  eq(r.success, true, r.message);
  eq(r.deleted.jamaah, 4); eq(r.deleted.keluarga, 1);
  assert(!env.ss.sheets.Jamaah.rows.some(x => x[1] === 'KK-B'), "anggota KK-B masih ada");
  assert(!env.ss.sheets.Keluarga.rows.some(x => x[0] === 'KK-B'), "KK-B masih ada");
  eq(env.ss.sheets.Arsip_Jamaah.getLastRow(), 5);
  eq(env.ss.sheets.Arsip_Keluarga.rows[1][2], 'KK-B');
  eq(env.ss.sheets.Jamaah.getLastRow(), 6, "anggota KK lain utuh");
});

test("Hapus KK dari daftar keluarga (deleteKeluarga)", () => {
  const env = createSandbox();
  const t = env.gs.login('246810', 'index').token;
  const r = env.gs.deleteKeluarga(t, 'KK-A', 'Pindah domisili');
  eq(r.success, true, r.message);
  eq(r.deleted.jamaah, 2);
  assert(!env.ss.sheets.Jamaah.rows.some(x => x[1] === 'KK-A'));
});

test("Hapus: VIEWER & tanpa token ditolak, ID tidak ada & mode salah ditolak", () => {
  const env = createSandbox();
  const tv = env.gs.login('135790', 'view').token;
  eq(env.gs.deleteJamaah(tv, 'JM-1', 'single', 'Pindah domisili').authError, true);
  eq(env.gs.deleteKeluarga(undefined, 'KK-A', 'Pindah domisili').authError, true);
  const t = env.gs.login('246810', 'index').token;
  eq(env.gs.deleteJamaah(t, 'JM-404', 'single', 'Pindah domisili').success, false);
  eq(env.gs.deleteJamaah(t, 'JM-1', 'semua', 'Pindah domisili').success, false);
  eq(env.ss.sheets.Jamaah.getLastRow(), 10, "tidak ada yang terhapus");
});

// --- Alasan hapus, arsip & pulihkan ----------------------------------------
test("Hapus tanpa alasan / alasan terlalu pendek ditolak dan tidak menghapus apa pun", () => {
  const env = createSandbox();
  const t = env.gs.login('246810', 'index').token;
  [undefined, '', '   ', 'ab'].forEach(a => {
    const r = env.gs.deleteJamaah(t, 'JM-5', 'single', a);
    eq(r.success, false); assert(/Alasan hapus wajib/.test(r.message), r.message);
  });
  const rk = env.gs.deleteKeluarga(t, 'KK-A', '');
  eq(rk.success, false); assert(/Alasan hapus wajib/.test(rk.message), rk.message);
  eq(env.ss.sheets.Jamaah.getLastRow(), 10, "tidak ada yang terhapus");
  assert(!env.ss.sheets.Arsip_Jamaah, "arsip tidak dibuat");
});

test("Hapus seluruh KK: alasan dicatat dengan penanda [Hapus seluruh KK] di arsip jamaah & KK", () => {
  const env = createSandbox();
  const t = env.gs.login('246810', 'index').token;
  eq(env.gs.deleteKeluarga(t, 'KK-A', 'Pindah ke luar kota').success, true);
  eq(env.ss.sheets.Arsip_Jamaah.rows[1][1], '[Hapus seluruh KK] Pindah ke luar kota');
  eq(env.ss.sheets.Arsip_Keluarga.rows[1][1], '[Hapus seluruh KK] Pindah ke luar kota');
});

test("getArsipJamaah: hanya ADMIN; berisi alasan, status KK, terbaru di atas", () => {
  const env = createSandbox();
  const t = env.gs.login('246810', 'index').token;
  const tv = env.gs.login('135790', 'view').token;
  eq(env.gs.getArsipJamaah(tv).authError, true);
  eq(env.gs.getArsipJamaah(t).data.length, 0, "arsip kosong sebelum ada yang dihapus");
  env.gs.deleteJamaah(t, 'JM-5', 'single', 'Meninggal dunia');
  env.gs.deleteKeluarga(t, 'KK-A', 'Pindah ke luar kota');
  const list = env.gs.getArsipJamaah(t).data;
  eq(list.length, 3);
  const j5 = list.find(x => x.id_jamaah === 'JM-5');
  eq(j5.keterangan, 'Meninggal dunia'); eq(j5.kk_status, 'ada');
  const ka = list.filter(x => x.id_keluarga === 'KK-A');
  eq(ka.length, 2); ka.forEach(x => eq(x.kk_status, 'arsip'));
  assert(ka[0].nama_kk, "nama KK dari arsip terisi");
});

test("Pulihkan jamaah: data kembali persis (termasuk telepon & dibantu), arsip diberi Waktu Pulih", () => {
  const env = createSandbox();
  const t = env.gs.login('246810', 'index').token;
  const sh = env.ss.sheets.Jamaah;
  env.gs.saveSensusData(t, validJamaah({ id_jamaah: 'JM-1', id_keluarga: 'KK-A', hubungan_keluarga: 'A', nama_lengkap: 'Bapak Contoh Satu', status_nikah: 'MENIKAH', tahun_lahir: 1956, no_telepon: '081234567890', perlu_dibantu: 'Y' }));
  const before = sh.rows.find(x => x[0] === 'JM-1').slice();
  eq(env.gs.deleteJamaah(t, 'JM-1', 'single', 'Salah input').success, true);
  const item = env.gs.getArsipJamaah(t).data.find(x => x.id_jamaah === 'JM-1');
  const r = env.gs.restoreJamaah(t, item.row, 'JM-1');
  eq(r.success, true, r.message);
  const after = sh.rows.find(x => x[0] === 'JM-1');
  assert(after, "JM-1 kembali ada");
  for (let c = 0; c < 12; c++) eq(String(after[c]), String(before[c]), "kolom " + (c + 1));
  eq(after[6], 1956, "tahun lahir tetap angka");
  const H = sh.rows[0];
  eq(after[H.indexOf('No Telepon', 12)], '081234567890');
  eq(after[H.indexOf('Perlu Dibantu')], 'Y');
  eq(env.gs.getArsipJamaah(t).data.some(x => x.id_jamaah === 'JM-1'), false, "tidak tampil lagi di daftar arsip");
  const ar = env.ss.sheets.Arsip_Jamaah;
  assert(ar.rows[item.row - 1][ar.rows[0].indexOf('Waktu Pulih')], "Waktu Pulih terisi (riwayat tetap ada)");
  eq(env.gs.restoreJamaah(t, item.row, 'JM-1').success, false, "tidak bisa dipulihkan dua kali");
});

test("Pulihkan anggota dari KK yang ikut terhapus: KK dipulihkan juga, sekali saja", () => {
  const env = createSandbox();
  const t = env.gs.login('246810', 'index').token;
  env.gs.deleteKeluarga(t, 'KK-A', 'Pindah ke luar kota');
  const list = env.gs.getArsipJamaah(t).data.filter(x => x.id_keluarga === 'KK-A');
  const r1 = env.gs.restoreJamaah(t, list[0].row, list[0].id_jamaah);
  eq(r1.success, true, r1.message); assert(/ikut dipulihkan/.test(r1.message), r1.message);
  eq(env.ss.sheets.Keluarga.rows.filter(x => x[0] === 'KK-A').length, 1, "KK-A kembali");
  const r2 = env.gs.restoreJamaah(t, list[1].row, list[1].id_jamaah);
  eq(r2.success, true, r2.message); assert(!/ikut dipulihkan/.test(r2.message), "KK tidak dipulihkan dua kali");
  eq(env.ss.sheets.Keluarga.rows.filter(x => x[0] === 'KK-A').length, 1);
  eq(env.ss.sheets.Jamaah.rows.filter(x => x[1] === 'KK-A').length, 2);
});

test("Pulihkan: KK sudah tidak ada di mana pun -> jadi jamaah tanpa KK; ID bentrok & baris salah ditolak", () => {
  const env = createSandbox();
  const t = env.gs.login('246810', 'index').token;
  env.gs.deleteJamaah(t, 'JM-5', 'single', 'Meninggal dunia');
  // KK-nya dihapus manual di sheet (tanpa arsip)
  const idKK = env.ss.sheets.Arsip_Jamaah.rows[1][3];
  const kRow = env.ss.sheets.Keluarga.rows.findIndex(x => x[0] === idKK);
  env.ss.sheets.Keluarga.deleteRow(kRow + 1);
  const item = env.gs.getArsipJamaah(t).data[0];
  eq(item.kk_status, 'hilang');
  eq(env.gs.restoreJamaah(t, item.row, 'JM-SALAH').success, false, "ID tidak cocok ditolak");
  eq(env.gs.restoreJamaah(env.gs.login('135790', 'view').token, item.row, 'JM-5').authError, true);
  const r = env.gs.restoreJamaah(t, item.row, 'JM-5');
  eq(r.success, true, r.message); assert(/tanpa KK/.test(r.message), r.message);
  eq(env.ss.sheets.Jamaah.rows.find(x => x[0] === 'JM-5')[1], '');
  // dihapus lagi lalu ID yang sama dibuat manual -> pulihkan ditolak
  env.gs.deleteJamaah(t, 'JM-5', 'single', 'Uji ulang');
  const again = env.gs.getArsipJamaah(t).data.find(x => x.id_jamaah === 'JM-5');
  env.ss.sheets.Jamaah.appendRow(['JM-5', '', 'C', 'Duplikat', 'Dup', 'L', 1990, 'BELUM', 'Y', 'Y', 'Menetap', '']);
  const rd = env.gs.restoreJamaah(t, again.row, 'JM-5');
  eq(rd.success, false); assert(/sudah ada/.test(rd.message), rd.message);
});

test("doPost: getArsipJamaah & restoreJamaah bisa dipanggil lewat API", () => {
  const env = createSandbox();
  const tok = post(env.gs, { action: 'login', args: ['246810', 'index'] }).token;
  eq(post(env.gs, { action: 'deleteJamaah', args: [tok, 'JM-5', 'single', 'Meninggal dunia'] }).success, true);
  const list = post(env.gs, { action: 'getArsipJamaah', args: [tok] }).data;
  eq(list.length, 1);
  eq(post(env.gs, { action: 'restoreJamaah', args: [tok, list[0].row, 'JM-5'] }).success, true);
});

test("Sheet Jamaah punya kolom 'Keterangan' / nama kembar sendiri: alasan hapus tidak tertimpa", () => {
  const env = createSandbox();
  const sh = env.ss.sheets.Jamaah;
  sh.rows[0][14] = 'Keterangan';
  sh.rows.find(x => x[0] === 'JM-5')[14] = 'catatan milik pengguna';
  const t = env.gs.login('246810', 'index').token;
  eq(env.gs.deleteJamaah(t, 'JM-5', 'single', 'Meninggal dunia').success, true);
  const ar = env.ss.sheets.Arsip_Jamaah, H = ar.rows[0];
  eq(ar.rows[1][H.indexOf('Keterangan')], 'Meninggal dunia', "alasan tersimpan di kolom Keterangan");
  eq(ar.rows[1][H.indexOf('Keterangan (data asal)')], 'catatan milik pengguna', "kolom pengguna tetap terarsip");
  eq(env.gs.getArsipJamaah(t).data[0].keterangan, 'Meninggal dunia');
  const r = env.gs.restoreJamaah(t, env.gs.getArsipJamaah(t).data[0].row, 'JM-5');
  eq(r.success, true, r.message);
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
// --- Pilihan Status Keberadaan ---------------------------------------------
const KB_SHEET = 'Pengaturan_Keberadaan';
const kbRows = (env) => env.ss.sheets[KB_SHEET].rows.slice(1).map(r => r[1]).filter(v => v !== '' && v !== undefined);

test("Keberadaan: sheet Pengaturan_Keberadaan dibuat otomatis dengan 4 pilihan bawaan", () => {
  const env = createSandbox();
  const t = env.gs.login('246810', 'index').token;
  const d = env.gs.getSensusData(t).data;
  eq(JSON.stringify(d.keberadaanOptions), JSON.stringify(["Menetap", "Mondok", "Tugas", "Kerja Luar"]));
  eq(JSON.stringify(kbRows(env)), JSON.stringify(["Menetap", "Mondok", "Tugas", "Kerja Luar"]));
});

test("Keberadaan: tambah 'Sekolah di Luar' lalu simpan jamaah dengan status itu", () => {
  const env = createSandbox();
  const t = env.gs.login('246810', 'index').token;
  const before = env.gs.getSensusData(t).data.rekap;
  const s = env.gs.saveKeberadaanConfig(t, ["Menetap", "Mondok", "Sekolah di Luar", "Tugas", "Kerja Luar"]);
  eq(s.success, true, s.message);
  eq(kbRows(env)[2], "Sekolah di Luar");
  const r = env.gs.saveSensusData(t, validJamaah({ status_keberadaan: "Sekolah di Luar", is_aktif: "N", flag_absen: "N" }));
  eq(r.success, true, r.message);
  const d = env.gs.getSensusData(t).data;
  const j = d.jamaah.find(x => x.nama_lengkap === 'Anak Contoh Baru');
  eq(j.status_keberadaan, "Sekolah di Luar");
  eq(d.rekap.total_aktif, before.total_aktif, "jamaah tidak aktif tidak menambah jiwa aktif");
  eq(d.warnings.length, 0);
});

test("Keberadaan: status yang belum ada di Pengaturan ditolak saat simpan", () => {
  const env = createSandbox();
  const t = env.gs.login('246810', 'index').token;
  const r = env.gs.saveSensusData(t, validJamaah({ status_keberadaan: "Sekolah di Luar" }));
  eq(r.success, false); assert(/belum ada di Pengaturan/.test(r.message), r.message);
});

test("Keberadaan: pilihan yang masih dipakai tidak bisa dihapus (pesan berisi jumlah)", () => {
  const env = createSandbox();
  const t = env.gs.login('246810', 'index').token;
  const r = env.gs.saveKeberadaanConfig(t, ["Menetap", "Tugas", "Kerja Luar"]);
  eq(r.success, false); assert(/'Mondok' \(masih dipakai 1 jamaah\)/.test(r.message), r.message);
  eq(kbRows(env).length, 4, "pengaturan tidak berubah");
});

test("Keberadaan: pilihan tak terpakai boleh dihapus; Menetap selalu ada & di urutan pertama", () => {
  const env = createSandbox();
  const t = env.gs.login('246810', 'index').token;
  const r = env.gs.saveKeberadaanConfig(t, ["Mondok", "Kerja Luar"]);
  eq(r.success, true, r.message);
  eq(JSON.stringify(r.options), JSON.stringify(["Menetap", "Mondok", "Kerja Luar"]));
  const r2 = env.gs.saveKeberadaanConfig(t, ["Kerja Luar", "menetap", "Mondok"]);
  eq(JSON.stringify(r2.options), JSON.stringify(["Menetap", "Kerja Luar", "Mondok"]));
});

const badKb = [
  ["nama ganda", ["Menetap", "Mondok", "mondok"], /lebih dari sekali/],
  ["nama terlalu panjang", ["Menetap", "x".repeat(31)], /terlalu panjang/],
  ["diawali tanda =", ["Menetap", "=HYPERLINK(1)"], /tidak boleh diawali/],
  ["lebih dari 20", Array.from({ length: 21 }, (_, i) => "Opsi " + i), /Maksimal 20/],
  ["bukan array", "Menetap", /tidak valid/]
];
badKb.forEach(([name, list, re]) => {
  test(`Keberadaan ditolak: ${name}`, () => {
    const env = createSandbox();
    const t = env.gs.login('246810', 'index').token;
    const r = env.gs.saveKeberadaanConfig(t, list);
    eq(r.success, false); assert(re.test(r.message), r.message);
  });
});

test("Keberadaan: VIEWER & tanpa token tidak boleh menyimpan; lewat doPost API berhasil", () => {
  const env = createSandbox();
  const v = env.gs.login('135790', 'view').token;
  eq(env.gs.saveKeberadaanConfig(v, ["Menetap"]).authError, true);
  eq(env.gs.saveKeberadaanConfig('', ["Menetap"]).authError, true);
  const a = env.gs.login('246810', 'index').token;
  const r = post(env.gs, { action: 'saveKeberadaanConfig', args: [a, ["Menetap", "Mondok", "Tugas", "Kerja Luar", "Sekolah di Luar"]] });
  eq(r.success, true, r.message);
});

test("Keberadaan: nilai di sheet beda huruf besar/kecil dinormalkan; nilai asing tetap tampil + peringatan", () => {
  const env = createSandbox();
  const rows = env.ss.sheets.Jamaah.rows;
  rows.find(r => r[0] === 'JM-8')[10] = 'mondok';
  rows.find(r => r[0] === 'JM-7')[10] = 'Sekolah di Luar';
  rows.find(r => r[0] === 'JM-9')[10] = '';
  const t = env.gs.login('246810', 'index').token;
  const d = env.gs.getSensusData(t).data;
  eq(d.jamaah.find(j => j.nama_lengkap === 'Anak Mondok Dua').status_keberadaan, 'Mondok');
  eq(d.jamaah.find(j => j.nama_lengkap === 'Ibu Contoh Tiga').status_keberadaan, 'Sekolah di Luar');
  eq(d.jamaah.find(j => j.nama_lengkap === 'Anak Tanpa Tahun').status_keberadaan, 'Menetap');
  eq(d.warnings.length, 1); assert(/'Sekolah di Luar' \(1 jamaah\)/.test(d.warnings[0]), d.warnings[0]);
  // menghapus pilihan yang tidak ada di daftar tidak berpengaruh; menambahkannya menghilangkan peringatan
  env.gs.saveKeberadaanConfig(t, ["Menetap", "Mondok", "Tugas", "Kerja Luar", "Sekolah di Luar"]);
  eq(env.gs.getSensusData(t).data.warnings.length, 0);
});

test("Keberadaan: halaman pengurus menerima daftar pilihan", () => {
  const env = createSandbox();
  const t = env.gs.login('135790', 'view').token;
  eq(env.gs.getSensusData(t).data.keberadaanOptions.length, 4);
});

test("Keberadaan: sheet Pengaturan_Keberadaan rusak (nama ganda) -> memakai bawaan", () => {
  const env = createSandbox();
  env.ss.sheets[KB_SHEET] = new MockSheet(KB_SHEET, ["Urutan", "Status Keberadaan"], [[1, "Menetap"], [2, "Mondok"], [3, "MONDOK"]]);
  const t = env.gs.login('246810', 'index').token;
  eq(env.gs.getSensusData(t).data.keberadaanOptions.length, 4);
});

test("Migrasi: kolom Absen berisi pilihan keberadaan tambahan ikut dikenali", () => {
  const env = createSandbox();
  const a = env.gs.login('246810', 'index').token;
  env.gs.saveKeberadaanConfig(a, ["Menetap", "Mondok", "Tugas", "Kerja Luar", "Sekolah di Luar"]);
  env.session.active = env.session.owner;
  env.ss.sheets.Sensus_Asal = new MockSheet("Sensus_Asal", ["No"], [
    [1, "Y", "Kepala Satu", "", "A", "L", 1970, "", "Y", "", "MENIKAH", ""],
    [2, "Y", "Anak Satu", "", "C", "L", 2006, "", "sekolah di luar", "", "", ""]
  ]);
  const r = env.gs.jalankanMigrasiSensus();
  eq(r.success, true, r.message);
  const anak = env.ss.sheets.Jamaah.rows[2];
  eq(anak[3], "Anak Satu"); eq(anak[10], "Sekolah di Luar"); eq(anak[9], "N");
});

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
process.exit(failed ? 1 : 0)