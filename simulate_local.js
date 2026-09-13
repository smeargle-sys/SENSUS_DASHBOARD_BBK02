const fs = require('fs');
const path = require('path');
const vm = require('vm');

// --- Mock Google Apps Script Environment ---
class MockSheet {
  constructor(name, headers, rows) {
    this.name = name;
    this.rows = [headers, ...rows];
  }

  getLastRow() {
    return this.rows.length;
  }

  getLastColumn() {
    return this.rows[0] ? this.rows[0].length : 0;
  }

  getRange(row, col, numRows, numCols) {
    const rStart = row - 1;
    const cStart = col - 1;
    const self = this;

    return {
      getValues() {
        const result = [];
        for (let r = 0; r < numRows; r++) {
          const rowIndex = rStart + r;
          if (self.rows[rowIndex]) {
            const rowData = [];
            for (let c = 0; c < numCols; c++) {
              const colIndex = cStart + c;
              rowData.push(self.rows[rowIndex][colIndex] !== undefined ? self.rows[rowIndex][colIndex] : "");
            }
            result.push(rowData);
          }
        }
        return result;
      },
      setValues(values) {
        console.log(`\n\x1b[36m[Mock Sheet - ${self.name}]\x1b[0m setValues() called at row ${row}, col ${col}`);
        for (let r = 0; r < values.length; r++) {
          const rowIndex = rStart + r;
          if (!self.rows[rowIndex]) {
            self.rows[rowIndex] = [];
          }
          for (let c = 0; c < values[r].length; c++) {
            const colIndex = cStart + c;
            self.rows[rowIndex][colIndex] = values[r][c];
          }
        }
        return this;
      }
    };
  }

  appendRow(rowContents) {
    console.log(`\n\x1b[36m[Mock Sheet - ${this.name}]\x1b[0m appendRow() called with:`, rowContents);
    this.rows.push(rowContents);
    return this;
  }
}

class MockSpreadsheet {
  constructor() {
    // Initial mock data from spreadsheet image for testing
    this.sheets = {
      "Keluarga": new MockSheet(
        "Keluarga",
        ["ID Keluarga", "Nama KK", "Alamat", "No Telepon"],
        [
          ["KK-A", "H. Sutardjo", "Babakan Barat RT 01", "081234567"],
          ["KK-B", "Daud Wibisono", "Babakan Barat RT 02", "0857112233"],
          ["KK-C", "H. Slamet Riyadi", "Babakan Barat RT 03", "0819998877"]
        ]
      ),
      "Jamaah": new MockSheet(
        "Jamaah",
        [
          "ID Jamaah", "ID Keluarga", "Hubungan Keluarga", "Nama Lengkap", 
          "Nama Absen", "Jenis Kelamin", "Tahun Lahir", "Status Nikah", 
          "Status Keaktifan", "Flag Absen", "Status Keberadaan", "Catatan"
        ],
        [
          // JM-1: H. Sutardjo
          ["JM-1", "KK-A", "A", "H. Sutardjo", "Sutardjo", "L", 1956, "MENIKAH", "Y", "Y", "Menetap", ""],
          // JM-2: Sunarni
          ["JM-2", "KK-A", "B", "Sunarni", "Sunarni Sutardjo", "P", 1968, "MENIKAH", "Y", "Y", "Menetap", ""],
          // JM-3: Daud Wibisono
          ["JM-3", "KK-B", "A", "Daud Wibisono", "Daud Wibisono", "L", 1997, "MENIKAH", "Y", "Y", "Menetap", ""],
          // JM-4: Amalia Istiqomah
          ["JM-4", "KK-B", "B", "Amalia Istiqomah", "Amalia Isti Wibi", "P", 1999, "MENIKAH", "Y", "Y", "Menetap", ""],
          // JM-5: Zafran Shaum Wibisono (Balita)
          ["JM-5", "KK-B", "C", "Zafran Shaum Wibisono", "Zafran Shaum Wibisono", "L", 2025, "BELUM", "Y", "N", "Menetap", ""],
          // JM-6: Slamet Riyadi
          ["JM-6", "KK-C", "A", "H. Slamet Riyadi", "Slamet Riyadi", "L", 1967, "MENIKAH", "Y", "Y", "Menetap", ""],
          // JM-7: Yusrida Djamal
          ["JM-7", "KK-C", "B", "Yusrida Djamal", "Yusrida Djamal Slamet.R", "P", 1964, "MENIKAH", "Y", "Y", "Menetap", ""],
          // JM-8: Michelle Keisha Ba (Remaja/Mondok, Inaktif lokal, Absen N)
          ["JM-8", "KK-B", "C", "Michelle Keisha Ba", "Michelle Keisha Ba", "P", 2010, "BELUM", "N", "N", "Mondok", ""]
        ]
      )
    };
  }

  getSheetByName(name) {
    console.log(`\x1b[36m[Mock Spreadsheet]\x1b[0m Accessing sheet tab: "${name}"`);
    return this.sheets[name] || null;
  }

  insertSheet(name) {
    console.log(`\x1b[36m[Mock Spreadsheet]\x1b[0m insertSheet() called for name: "${name}"`);
    if (!this.sheets[name]) {
      this.sheets[name] = new MockSheet(name, [], []);
    }
    return this.sheets[name];
  }

  getSheets() {
    return Object.values(this.sheets);
  }
}

const SpreadsheetApp = {
  getActiveSpreadsheet() {
    if (!this.ssInstance) {
      this.ssInstance = new MockSpreadsheet();
    }
    return this.ssInstance;
  },
  openByUrl(url) {
    console.log(`\x1b[36m[Mock SpreadsheetApp]\x1b[0m openByUrl(${url}) called`);
    if (!this.ssInstance) {
      this.ssInstance = new MockSpreadsheet();
    }
    return this.ssInstance;
  }
};

const Session = {
  getScriptTimeZone() {
    return "Asia/Jakarta";
  }
};

const Utilities = {
  formatDate(date, tz, format) {
    if (date instanceof Date) {
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const d = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return String(date);
  }
};

const Logger = {
  log(msg) {
    console.log(`\x1b[33m[GAS Logger]\x1b[0m ${msg}`);
  }
};

// Create sandbox environment
const sandbox = {
  SpreadsheetApp,
  Session,
  Utilities,
  Logger,
  console,
  Date,
  isNaN,
  Number,
  String,
  JSON,
  Math
};

// Load backend Code.gs
const codePath = path.join(__dirname, 'Code.gs');
const sourceCode = fs.readFileSync(codePath, 'utf8');

// Run Code.gs inside sandbox
vm.createContext(sandbox);
vm.runInContext(sourceCode, sandbox);

console.log("================= MEMULAI SIMULASI BACKEND (LOCAL) =================");

try {
  // Test 1: Fetch Sensus Data
  console.log("\n--- TEST 1: Menjalankan getSensusData() ---");
  const result = sandbox.getSensusData();
  
  if (result.success) {
    console.log("\n\x1b[32m✔ SUCCESS: getSensusData() berhasil dijalankan!\x1b[0m");
    console.log(`\nJumlah KK Terdaftar: ${result.data.keluarga.length}`);
    console.log(`Jumlah Jamaah Terdaftar: ${result.data.jamaah.length}`);
    
    console.log("\n--- REKAPITULASI STATISTIK ---");
    console.log(`Total Jamaah: ${result.data.rekap.total} Jiwa`);
    console.log(`Laki-Laki: ${result.data.rekap.laki} Jiwa`);
    console.log(`Perempuan: ${result.data.rekap.perempuan} Jiwa`);
    console.log(`Duda: ${result.data.rekap.duda} Jiwa`);
    console.log(`Janda: ${result.data.rekap.janda} Jiwa`);
    console.log(`Lansia (>= 57 th): ${result.data.rekap.lansia} Jiwa`);
    
    console.log("\nDetail Per Kategori Usia:");
    console.table(result.data.rekap.detail);

    // Test 2: Simpan data Baru
    console.log("\n--- TEST 2: Menjalankan saveSensusData() untuk Jamaah Baru ---");
    const testNewJamaah = {
      id_keluarga: "KK-A",
      is_new_keluarga: false,
      hubungan_keluarga: "C",
      nama_lengkap: "Ricky Rahmat Fauzi",
      nama_absen: "Ricky Rahmat Fauzi",
      jenis_kelamin: "L",
      tahun_lahir: 2003, // Umur 23 th -> Usia (Pra) Nikah
      status_nikah: "BELUM",
      is_aktif: "Y",
      flag_absen: "Y",
      status_keberadaan: "Menetap",
      catatan: "Mahasiswa"
    };

    const saveResult = sandbox.saveSensusData(testNewJamaah);
    if (saveResult.success) {
      console.log("\x1b[32m✔ SUCCESS: saveSensusData() berhasil menyimpan data!\x1b[0m");
      
      // Ambil data ulang setelah insert
      const updatedResult = sandbox.getSensusData();
      console.log(`\nJumlah Jamaah setelah insert: ${updatedResult.data.jamaah.length}`);
      
      const newSaved = updatedResult.data.jamaah.find(j => j.nama_lengkap === "Ricky Rahmat Fauzi");
      console.log("Data Baru yang tersimpan:", JSON.stringify(newSaved, null, 2));
    } else {
      console.log("\x1b[31m✘ FAILED: saveSensusData() gagal:\x1b[0m", saveResult.message);
    }
  } else {
    console.log("\n\x1b[31m✘ FAILED: getSensusData() mengembalikan error:\x1b[0m", result.message);
  }
} catch (err) {
  console.error("\n\x1b[31m✘ CRITICAL ERROR SAAT SIMULASI:\x1b[0m", err);
}

console.log("\n================= SIMULASI SELESAI =================");
