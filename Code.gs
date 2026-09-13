/**
 * Sensus Jamaah Babakan Barat - Google Apps Script Backend
 * File ini menangani server-side logic, interaksi dengan Google Sheets,
 * otomatisasi perhitungan kategori usia, dan rekapitulasi data.
 */

var CONFIG = {
  SHEET_KELUARGA: "Keluarga",
  SHEET_JAMAAH: "Jamaah",
  FALLBACK_URL: "" // Masukkan URL Google Spreadsheet Anda di sini jika dijalankan di luar konteks container
};

/**
 * Web App Entry Point (doGet)
 * Menyajikan halaman HTML utama
 */
function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) || 'index';
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

/**
 * Mendapatkan instance Spreadsheet secara dinamis
 */
function getSpreadsheet() {
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
  return ss;
}

/**
 * Inisialisasi sheet jika belum ada (membuat sheet Keluarga & Jamaah dengan header standar)
 */
function initializeSheets() {
  var ss = getSpreadsheet();
  if (!ss) return;

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
}

/**
 * Rule Engine: Menentukan Kategori Usia secara dinamis
 * @param {number} tahunLahir
 * @param {string} statusNikah
 * @return {string} Kategori Usia
 */
function dapatkanKategoriUsia(tahunLahir, statusNikah) {
  var tahunSekarang = new Date().getFullYear();
  var umur = tahunSekarang - tahunLahir;
  
  // Normalisasi input
  var status = (statusNikah || "").toUpperCase().trim();

  // Jika status pernikahan adalah Menikah, Duda, atau Janda, otomatis masuk kategori Dewasa
  if (status === "MENIKAH" || status === "DUDA" || status === "JANDA") {
    return "Dewasa Menikah";
  }
  
  if (umur <= 5) return "BALITA-PAUD";
  if (umur <= 12) return "Caberawit";
  if (umur <= 15) return "Pra Remaja (SMP)";
  if (umur <= 17) return "Remaja (SMA)";
  return "Usia (Pra) Menikah";
}

/**
 * Mengambil data sensus dan memproses rekapitulasi statistik
 */
function getSensusData() {
  try {
    initializeSheets();
    var ss = getSpreadsheet();
    if (!ss) {
      throw new Error("Spreadsheet tidak ditemukan!");
    }

    var shKeluarga = ss.getSheetByName(CONFIG.SHEET_KELUARGA);
    var shJamaah = ss.getSheetByName(CONFIG.SHEET_JAMAAH);

    // 1. Ambil data keluarga
    var keluargaList = [];
    var keluargaMap = {}; // Untuk pencarian cepat nama KK berdasarkan ID Keluarga
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

    // 2. Ambil data jamaah
    var jamaahList = [];
    var lastRowJamaah = shJamaah.getLastRow();
    
    // Struktur rekap awal
    var rekap = {
      total: 0,
      laki: 0,
      perempuan: 0,
      duda: 0,
      janda: 0,
      lansia: 0,
      kkCount: 0,
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

    if (lastRowJamaah > 1) {
      var valJamaah = shJamaah.getRange(2, 1, lastRowJamaah - 1, 12).getValues();
      var tahunSekarang = new Date().getFullYear();

      for (var j = 0; j < valJamaah.length; j++) {
        var jRow = valJamaah[j];
        if (!jRow[0]) continue; // Lewati jika ID kosong

        var idKeluarga = String(jRow[1]);
        var hubKeluarga = String(jRow[2]).toUpperCase();
        var namaLengkap = String(jRow[3]);
        var namaAbsen = String(jRow[4]);
        var jk = String(jRow[5]).toUpperCase(); // L atau P
        var tahunLahir = Number(jRow[6]) || tahunSekarang;
        var statusNikah = String(jRow[7]).toUpperCase();
        var isAktif = String(jRow[8]).toUpperCase() === "N" ? "N" : "Y";
        var flagAbsen = String(jRow[9]).toUpperCase() === "N" ? "N" : "Y";
        var statusKeberadaan = String(jRow[10]);
        var catatan = String(jRow[11]);

        if (hubKeluarga === "A" && isAktif === "N") {
          inactiveKeluargaIds[idKeluarga] = true;
        }

        var umur = tahunSekarang - tahunLahir;
        var kategoriUsia = dapatkanKategoriUsia(tahunLahir, statusNikah);

        var jObj = {
          id_jamaah: String(jRow[0]),
          id_keluarga: idKeluarga,
          nama_kk: keluargaMap[idKeluarga] || "Tidak Terdaftar",
          hubungan_keluarga: hubKeluarga,
          nama_lengkap: namaLengkap,
          nama_absen: namaAbsen,
          jenis_kelamin: jk,
          tahun_lahir: tahunLahir,
          umur: umur,
          status_nikah: statusNikah,
          is_aktif: isAktif,
          flag_absen: flagAbsen,
          status_keberadaan: statusKeberadaan,
          kategori_usia: kategoriUsia,
          catatan: catatan
        };

        jamaahList.push(jObj);

        // Agregasi rekap (Hanya jika isAktif === 'Y')
        if (isAktif === "Y") {
          rekap.total++;
          if (jk === "L") {
            rekap.laki++;
          } else if (jk === "P") {
            rekap.perempuan++;
          }

          if (statusNikah === "DUDA") {
            rekap.duda++;
          } else if (statusNikah === "JANDA") {
            rekap.janda++;
          }

          if (umur >= 57) {
            rekap.lansia++;
          }

          if (rekap.detail[kategoriUsia]) {
            if (jk === "L" || jk === "P") {
              if (statusNikah !== "DUDA" && statusNikah !== "JANDA") {
                rekap.detail[kategoriUsia][jk]++;
              }
            }
          }
        }
      }
    }

    var activeKkCount = 0;
    for (var i = 0; i < keluargaList.length; i++) {
      var idK = keluargaList[i].id_keluarga;
      if (!inactiveKeluargaIds[idK]) {
        activeKkCount++;
      }
    }
    rekap.kkCount = activeKkCount;

    return {
      success: true,
      data: {
        jamaah: jamaahList,
        keluarga: keluargaList,
        rekap: rekap
      }
    };
  } catch (err) {
    return {
      success: false,
      message: err.toString(),
      data: null
    };
  }
}

/**
 * Menyimpan data sensus (menambah jamaah baru atau keluarga baru)
 * @param {object} formData
 */
function saveSensusData(formData) {
  try {
    initializeSheets();
    var ss = getSpreadsheet();
    if (!ss) {
      throw new Error("Spreadsheet tidak ditemukan!");
    }

    var shKeluarga = ss.getSheetByName(CONFIG.SHEET_KELUARGA);
    var shJamaah = ss.getSheetByName(CONFIG.SHEET_JAMAAH);
    var timestamp = new Date().getTime();

    var idKeluarga = formData.id_keluarga;

    // 1. Simpan keluarga baru jika ditandai
    if (formData.is_new_keluarga) {
      idKeluarga = "KK-" + timestamp;
      shKeluarga.appendRow([
        idKeluarga,
        formData.nama_kk || "Tanpa Nama",
        formData.alamat || "",
        formData.telepon || ""
      ]);
    }

    // 2. Simpan atau edit jamaah
    if (formData.id_jamaah) {
      // PROSES EDIT JAMAAH EXIST
      var lastRowJamaah = shJamaah.getLastRow();
      var range = shJamaah.getRange(2, 1, lastRowJamaah - 1, 1);
      var values = range.getValues();
      var foundRowIndex = -1;

      for (var i = 0; i < values.length; i++) {
        if (String(values[i][0]) === String(formData.id_jamaah)) {
          foundRowIndex = i + 2; // Baris riil di sheet (1-based + 2 offset)
          break;
        }
      }

      if (foundRowIndex === -1) {
        throw new Error("Data Jamaah dengan ID " + formData.id_jamaah + " tidak ditemukan.");
      }

      // Update nilai di baris yang ditemukan
      shJamaah.getRange(foundRowIndex, 2, 1, 11).setValues([[
        idKeluarga,
        formData.hubungan_keluarga || "C",
        formData.nama_lengkap || "",
        formData.nama_absen || "",
        formData.jenis_kelamin || "L",
        Number(formData.tahun_lahir) || new Date().getFullYear(),
        formData.status_nikah || "BELUM",
        formData.is_aktif || "Y",
        formData.flag_absen || "Y",
        formData.status_keberadaan || "Menetap",
        formData.catatan || ""
      ]]);

    } else {
      // PROSES JAMAAH BARU
      var idJamaah = "JM-" + timestamp;
      shJamaah.appendRow([
        idJamaah,
        idKeluarga,
        formData.hubungan_keluarga || "C",
        formData.nama_lengkap || "",
        formData.nama_absen || "",
        formData.jenis_kelamin || "L",
        Number(formData.tahun_lahir) || new Date().getFullYear(),
        formData.status_nikah || "BELUM",
        formData.is_aktif || "Y",
        formData.flag_absen || "Y",
        formData.status_keberadaan || "Menetap",
        formData.catatan || ""
      ]);
    }

    return {
      success: true,
      message: "Data berhasil disimpan!"
    };
  } catch (err) {
    return {
      success: false,
      message: "Gagal menyimpan data: " + err.toString()
    };
  }
}

/**
 * Script Migrasi Data Sensus Lama ke Struktur Baru
 * 
 * CARA MENGGUNAKAN:
 * 1. Letakkan seluruh data sensus lama Anda pada tab sheet bernama "Sensus_Asal" di spreadsheet ini.
 * 2. Pastikan urutan kolom di sheet "Sensus_Asal" adalah sebagai berikut:
 *    A: No (1, 2, 3...)
 *    B: Aktif (Y/N)
 *    C: Nama Lengkap
 *    D: Nama di Absen
 *    E: Kode Hubungan KK (A/B/C/D)
 *    F: Jenis Kelamin (L/P)
 *    G: TTL (Tahun Lahir saja, misal 1997)
 *    H: Umur
 *    I: Absen (Y/N/Mondok/Tugas/Kerja Luar)
 *    J: Kategori Usia
 *    K: Status Nikah (MENIKAH/JANDA/DUDA/dll)
 *    L: Catatan
 * 3. Jalankan fungsi ini dari Apps Script Editor.
 * 4. Fungsi ini akan membuat tab sheet "Keluarga" dan "Jamaah" secara otomatis dan mengisi datanya dengan benar.
 */
function jalankanMigrasiSensus() {
  try {
    var ss = getSpreadsheet();
    if (!ss) {
      throw new Error("Spreadsheet tidak ditemukan!");
    }

    var sheetAsal = ss.getSheetByName("Sensus_Asal");
    if (!sheetAsal) {
      throw new Error("Sheet bernama 'Sensus_Asal' tidak ditemukan. Pastikan Anda menyalin data lama ke tab 'Sensus_Asal'.");
    }

    initializeSheets();
    
    var shKeluarga = ss.getSheetByName(CONFIG.SHEET_KELUARGA);
    var shJamaah = ss.getSheetByName(CONFIG.SHEET_JAMAAH);

    // Hapus data lama di sheet baru (jika ada, untuk menghindari duplikasi saat pengujian)
    if (shKeluarga.getLastRow() > 1) {
      shKeluarga.getRange(2, 1, shKeluarga.getLastRow() - 1, shKeluarga.getLastColumn()).clearContent();
    }
    if (shJamaah.getLastRow() > 1) {
      shJamaah.getRange(2, 1, shJamaah.getLastRow() - 1, shJamaah.getLastColumn()).clearContent();
    }

    var lastRowAsal = sheetAsal.getLastRow();
    if (lastRowAsal <= 1) {
      throw new Error("Sheet 'Sensus_Asal' kosong atau hanya berisi header.");
    }

    var dataAsal = sheetAsal.getRange(2, 1, lastRowAsal - 1, 12).getValues();
    var timestamp = new Date().getTime();

    var currentKeluargaId = "";
    var currentNamaKK = "";
    var keluargaRows = [];
    var jamaahRows = [];

    for (var i = 0; i < dataAsal.length; i++) {
      var row = dataAsal[i];
      var namaLengkap = String(row[2]).trim();
      if (!namaLengkap) continue; // Lewati baris kosong

      var aktifVal = String(row[1]).toUpperCase().trim();
      var namaAbsen = String(row[3]).trim() || namaLengkap;
      var hubKeluarga = String(row[4]).toUpperCase().trim() || "C";
      var jk = String(row[5]).toUpperCase().trim() || "L";
      var tahunLahir = Number(row[6]) || new Date().getFullYear();
      var absenVal = String(row[8]).trim();
      var statusNikahVal = String(row[10]).toUpperCase().trim();
      var catatan = String(row[11]).trim();

      // Normalisasi flag keaktifan
      var isAktif = (aktifVal === "N") ? "N" : "Y";

      // Inisialisasi keberadaan dan flag absen dari kolom Absen lama
      var flagAbsen = "Y";
      var statusKeberadaan = "Menetap";
      
      var lowerAbsen = absenVal.toLowerCase();
      if (lowerAbsen === "mondok" || lowerAbsen === "tugas" || lowerAbsen === "kerja luar") {
        statusKeberadaan = absenVal;
        flagAbsen = "N"; // Default inaktif absen jika mondok/tugas/kerja luar
      } else if (absenVal === "N" || absenVal === "n") {
        flagAbsen = "N";
      }

      // Normalisasi status pernikahan
      var statusNikah = "BELUM";
      if (statusNikahVal.indexOf("MENIKAH") !== -1) {
        statusNikah = "MENIKAH";
      } else if (statusNikahVal.indexOf("JANDA") !== -1) {
        statusNikah = "JANDA";
      } else if (statusNikahVal.indexOf("DUDA") !== -1) {
        statusNikah = "DUDA";
      }

      // ALGORITMA PENGELOMPOKAN KELUARGA (KK)
      // Jika hubungan_keluarga === 'A' (Kepala Keluarga), maka buat keluarga baru
      if (hubKeluarga === "A" || !currentKeluargaId) {
        currentKeluargaId = "KK-" + timestamp + "_" + i;
        currentNamaKK = namaLengkap;
        
        // Simpan data keluarga baru
        keluargaRows.push([
          currentKeluargaId,
          currentNamaKK,
          "Alamat Babakan Barat", // Default alamat
          "" // Default telepon
        ]);
      }

      var idJamaah = "JM-" + timestamp + "_" + i;
      // Simpan data jamaah
      jamaahRows.push([
        idJamaah,
        currentKeluargaId,
        hubKeluarga,
        namaLengkap,
        namaAbsen,
        jk,
        tahunLahir,
        statusNikah,
        isAktif,
        flagAbsen,
        statusKeberadaan,
        catatan
      ]);
    }

    // Tulis ke sheet Keluarga & Jamaah secara batch (cepat)
    if (keluargaRows.length > 0) {
      shKeluarga.getRange(2, 1, keluargaRows.length, 4).setValues(keluargaRows);
    }
    if (jamaahRows.length > 0) {
      shJamaah.getRange(2, 1, jamaahRows.length, 12).setValues(jamaahRows);
    }

    Logger.log("Migrasi sukses! Memproses " + keluargaRows.length + " KK dan " + jamaahRows.length + " Jiwa.");
    return {
      success: true,
      message: "Migrasi sukses! Memproses " + keluargaRows.length + " KK dan " + jamaahRows.length + " Jiwa."
    };
  } catch (err) {
    Logger.log("Migrasi gagal: " + err.toString());
    return {
      success: false,
      message: "Gagal: " + err.toString()
    };
  }
}