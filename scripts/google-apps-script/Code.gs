/**
 * SPE UGM SC — Recruitment 2026/2027 Registration Backend
 * Google Apps Script Web App for Google Sheets & Google Drive
 *
 * Requirements:
 * - Deploy as Web App:
 *   - Execute as: Me (Organizer account)
 *   - Who has access: Anyone
 * - Script Properties to set in Apps Script Project Settings:
 *   - API_SECRET: Shared secret key for HMAC/Bearer authentication with Next.js backend
 *   - SPREADSHEET_ID: ID of the Google Sheet (optional if script is container-bound)
 *   - DRIVE_FOLDER_ID: ID of the private parent Google Drive folder for submissions
 *   - OPENS_AT (optional): ISO timestamp, e.g. "2026-11-04T00:00:00+07:00"
 *   - CLOSES_AT (optional): ISO timestamp, e.g. "2026-11-14T00:00:00+07:00"
 */

// Column definitions for the Google Sheet
var HEADERS = [
  "Timestamp (WIB)",
  "Receipt Number",
  "Idempotency Key",
  "Request Hash",
  "Full Name",
  "NIM",
  "Place of Birth",
  "Date of Birth",
  "UGM Email",
  "Phone Number",
  "Study Program / Major",
  "Cohort / Batch",
  "First Preference - Division",
  "First Preference - Sub-Division",
  "First Preference - Motivation",
  "Second Preference - Division",
  "Second Preference - Sub-Division",
  "Second Preference - Motivation",
  "CV Document URL",
  "ID Card Document URL",
  "Commitment Letter URL",
  "Instagram Follow Proof URL",
  "Instagram Story Proof URL",
  "First Preference Assignment URL",
  "Applicant Drive Folder URL",
  "Status",
  "MBTI Result URL",
  "UGM Group Sharing Proof URL"
];

function getProperties() {
  return PropertiesService.getScriptProperties();
}

function getSpreadsheet() {
  var props = getProperties();
  var sheetId = props.getProperty("SPREADSHEET_ID");
  if (sheetId && sheetId.trim().length > 0) {
    return SpreadsheetApp.openById(sheetId.trim());
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getRootFolder() {
  var props = getProperties();
  var folderId = props.getProperty("DRIVE_FOLDER_ID");
  if (!folderId || folderId.trim().length === 0) {
    throw new Error("DRIVE_FOLDER_ID is not configured in Script Properties");
  }
  return DriveApp.getFolderById(folderId.trim());
}

function getApplicationsSheet() {
  var ss = getSpreadsheet();
  if (!ss) {
    throw new Error("Spreadsheet not found or not accessible");
  }
  var sheet = ss.getSheetByName("Applications");
  if (!sheet) {
    sheet = ss.getSheets()[0];
    sheet.setName("Applications");
  }
  // Ensure the physical sheet has enough columns (e.g. expanding 26 cols to 28)
  var maxCols = sheet.getMaxColumns();
  if (maxCols < HEADERS.length) {
    sheet.insertColumnsAfter(maxCols, HEADERS.length - maxCols);
  }
  // Initialize headers if empty, or ensure new columns are labeled
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight("bold");
    sheet.setFrozenRows(1);
  } else {
    var lastCol = sheet.getLastColumn();
    if (lastCol < HEADERS.length) {
      for (var col = lastCol + 1; col <= HEADERS.length; col++) {
        sheet.getRange(1, col).setValue(HEADERS[col - 1]).setFontWeight("bold");
      }
    }
  }
  return sheet;
}

function sanitizeForSheet(val) {
  if (val === null || val === undefined) return "";
  var str = String(val);
  // Protect against spreadsheet formula injection (=, +, -, @, \t, \r)
  if (/^[=+@\-\t\r]/.test(str)) {
    return "'" + str;
  }
  return str;
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function bytesToHex(bytes) {
  return bytes.map(function(b) {
    var n = b < 0 ? b + 256 : b;
    return (n < 16 ? "0" : "") + n.toString(16);
  }).join("");
}

function verifyAuth(payload, e) {
  var expected = getProperties().getProperty("API_SECRET");
  if (!expected || expected.trim().length === 0) {
    throw new Error("API_SECRET is not configured in Script Properties");
  }
  var received = (payload && payload.authSecret) || (e && e.parameter && e.parameter.authSecret);
  if (!received || received !== expected.trim()) {
    throw new Error("Unauthorized: Invalid or missing integration secret");
  }
}

function checkRegistrationWindow() {
  var props = getProperties();
  var opensStr = props.getProperty("OPENS_AT") || "2026-11-05T00:00:00+07:00";
  var closesStr = props.getProperty("CLOSES_AT") || "2026-11-14T00:00:00+07:00";
  var now = new Date().getTime();
  var opensAt = new Date(opensStr).getTime();
  var closesAt = new Date(closesStr).getTime();

  if (isNaN(opensAt) || isNaN(closesAt)) {
    throw new Error("Registration date configuration is invalid.");
  }

  if (now < opensAt) {
    throw new Error("Applications open November 5, 2026 at 00:00 WIB.");
  }

  if (now >= closesAt) {
    throw new Error("Applications are now closed.");
  }
}

function findApplicationRow(sheet, keyColumn, value) {
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;
  var range = sheet.getRange(2, keyColumn, lastRow - 1, 1);
  var values = range.getValues();
  var target = String(value).toLowerCase().trim();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).toLowerCase().trim() === target) {
      return {
        rowIndex: i + 2,
        rowData: sheet.getRange(i + 2, 1, 1, HEADERS.length).getValues()[0]
      };
    }
  }
  return null;
}

function findApplicantFolder(rootFolder, idempotencyKey) {
  var shortKey = idempotencyKey.slice(0, 8);
  var folders = rootFolder.getFolders();
  while (folders.hasNext()) {
    var f = folders.next();
    if (f.getName().endsWith(" - " + shortKey)) {
      return f;
    }
  }
  return null;
}

function getOrCreateApplicantFolder(rootFolder, nim, fullName, idempotencyKey) {
  var existing = findApplicantFolder(rootFolder, idempotencyKey);
  var safeNim = String(nim || "").toLowerCase().trim();
  var cleanName = String(fullName || "").trim();
  var shortKey = idempotencyKey.slice(0, 8);

  if (existing) {
    // If folder was created with empty bracket prefix and we now have nim/fullName, rename it properly
    if (existing.getName().startsWith("[]") && (safeNim || cleanName)) {
      existing.setName("[" + safeNim + "] " + cleanName + " - " + shortKey);
    }
    return existing;
  }

  // Not found, create new folder with metadata established during init
  var folderName = "[" + safeNim + "] " + cleanName + " - " + shortKey;
  return rootFolder.createFolder(folderName);
}

function doGet(e) {
  return jsonResponse({
    ok: true,
    service: "SPE UGM SC Recruitment Backend",
    version: "2026/2027",
    timestamp: new Date().toISOString()
  });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ ok: false, error: "Empty or invalid request body." });
    }

    var payload = JSON.parse(e.postData.contents);
    verifyAuth(payload, e);

    var action = payload.action;
    var sheet = getApplicationsSheet();
    var rootFolder = getRootFolder();

    // ACTION: init
    if (action === "init") {
      checkRegistrationWindow();

      var idempotencyKey = payload.idempotencyKey;
      var nim = String(payload.nim || "").toLowerCase().trim();
      var fullName = String(payload.fullName || "").trim();

      if (!idempotencyKey || !nim || !fullName) {
        return jsonResponse({ ok: false, error: "Field pendaftaran tidak lengkap." });
      }

      // 1. Check idempotency: Col 3 (Idempotency Key)
      var existingKey = findApplicationRow(sheet, 3, idempotencyKey);
      if (existingKey) {
        var existingStatus = existingKey.rowData[25]; // Col Z
        var existingReceipt = existingKey.rowData[1]; // Col B
        if (existingStatus === "SUBMITTED") {
          return jsonResponse({
            ok: true,
            status: "already_submitted",
            applicationId: existingReceipt
          });
        }
      }

      // 2. Check duplicate NIM: Col 6 (NIM)
      var existingNim = findApplicationRow(sheet, 6, nim);
      if (existingNim) {
        var existingKeyForNim = existingNim.rowData[2]; // Col C
        if (existingKeyForNim !== idempotencyKey) {
          return jsonResponse({
            ok: false,
            error: "Pendaftaran tidak dapat dibuat. Jika pernah mendaftar dengan NIM ini, hubungi panitia."
          });
        }
      }

      // 3. Prepare or reuse applicant folder
      var applicantFolder = getOrCreateApplicantFolder(rootFolder, nim, fullName, idempotencyKey);
      var derivedReceiptId = "SPE-2026-" + nim.toUpperCase() + "-" + idempotencyKey.slice(0, 8).toUpperCase();

      return jsonResponse({
        ok: true,
        status: "ready",
        applicationId: derivedReceiptId,
        folderId: applicantFolder.getId()
      });
    }

    // ACTION: upload_file
    if (action === "upload_file") {
      var uploadKey = payload.idempotencyKey;
      var uploadNim = String(payload.nim || "").toLowerCase().trim();
      var uploadName = String(payload.fullName || "").trim();
      var slot = payload.slot;
      var filename = payload.filename;
      var mimeType = payload.mimeType;
      var sha256 = String(payload.sha256 || "").toLowerCase().trim();
      var base64Content = payload.base64Content;

      if (!uploadKey || !slot || !filename || !mimeType || !sha256 || !base64Content) {
        return jsonResponse({ ok: false, error: "Data unggahan file tidak lengkap." });
      }

      var folder = getOrCreateApplicantFolder(rootFolder, uploadNim, uploadName, uploadKey);

      // Bind file naming to applicant identity established during init
      var folderMatch = folder.getName().match(/^\[(.*?)\]/);
      if (folderMatch && folderMatch[1] && folderMatch[1].trim().length > 0) {
        var establishedNim = folderMatch[1].trim().toUpperCase();
        if (filename.indexOf("]") !== -1) {
          filename = "[" + establishedNim + "]" + filename.substring(filename.indexOf("]") + 1);
        }
      }

      var bytes = Utilities.base64Decode(base64Content);
      var computedDigest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
      var computedSha256 = bytesToHex(computedDigest);

      if (computedSha256 !== sha256) {
        return jsonResponse({
          ok: false,
          error: "Checksum dokumen (" + slot + ") tidak sesuai. Unggah ulang file."
        });
      }

      // Check for existing file with same slot prefix / filename to avoid duplicates
      var files = folder.getFilesByName(filename);
      while (files.hasNext()) {
        var oldFile = files.next();
        oldFile.setTrashed(true);
      }

      var blob = Utilities.newBlob(bytes, mimeType, filename);
      var newFile = folder.createFile(blob);

      return jsonResponse({
        ok: true,
        slot: slot,
        fileId: newFile.getId(),
        fileUrl: newFile.getUrl()
      });
    }

    // ACTION: finalize
    if (action === "finalize") {
      // Acquire exclusive lock before updating Google Sheets
      var acquired = lock.tryLock(15000);
      if (!acquired) {
        return jsonResponse({
          ok: false,
          error: "Sistem sedang sibuk memproses pengiriman lain. Coba beberapa saat lagi."
        });
      }

      var finalKey = payload.idempotencyKey;
      var finalHash = payload.hash;
      var v = payload.values || {};
      var finalNim = String(v.nim || "").toLowerCase().trim();
      var finalName = String(v.fullName || "").trim();
      var receiptId = payload.applicationId || ("SPE-2026-" + finalNim.toUpperCase() + "-" + finalKey.slice(0, 8).toUpperCase());

      // Re-verify under lock: idempotency
      var existingRow = findApplicationRow(sheet, 3, finalKey);
      if (existingRow && existingRow.rowData[25] === "SUBMITTED") {
        lock.releaseLock();
        return jsonResponse({
          ok: true,
          status: "submitted",
          applicationId: existingRow.rowData[1]
        });
      }

      // Re-verify under lock: NIM uniqueness
      var existingNimUnderLock = findApplicationRow(sheet, 6, finalNim);
      if (existingNimUnderLock && existingNimUnderLock.rowData[2] !== finalKey) {
        lock.releaseLock();
        return jsonResponse({
          ok: false,
          error: "Pendaftaran tidak dapat dibuat. Jika pernah mendaftar dengan NIM ini, hubungi panitia."
        });
      }

      // Document URLs mapping
      var docs = payload.documents || [];
      var docMap = {};
      for (var d = 0; d < docs.length; d++) {
        docMap[docs[d].slot] = docs[d].fileUrl;
      }

      var folder = getOrCreateApplicantFolder(rootFolder, finalNim, finalName, finalKey);
      var filesIter = folder.getFiles();
      while (filesIter.hasNext()) {
        var f = filesIter.next();
        var fn = f.getName().toLowerCase();
        if (fn.includes("cv") && !docMap["cv"]) docMap["cv"] = f.getUrl();
        else if (fn.includes("idcard") && !docMap["idCard"]) docMap["idCard"] = f.getUrl();
        else if (fn.includes("commitment") && !docMap["commitment"]) docMap["commitment"] = f.getUrl();
        else if (fn.includes("follow") && !docMap["followProof"]) docMap["followProof"] = f.getUrl();
        else if ((fn.includes("story") || fn.includes("sg")) && !docMap["storyProof"]) docMap["storyProof"] = f.getUrl();
        else if (fn.includes("assignment") && !docMap["assignment1"]) docMap["assignment1"] = f.getUrl();
        else if (fn.includes("mbti") && !docMap["mbti"]) docMap["mbti"] = f.getUrl();
        else if ((fn.includes("group") || fn.includes("ugm")) && !docMap["ugmGroupProof"]) docMap["ugmGroupProof"] = f.getUrl();
      }

      var timestamp = Utilities.formatDate(new Date(), "Asia/Jakarta", "yyyy-MM-dd HH:mm:ss 'WIB'");

      var newRow = [
        timestamp,                                       // A: Timestamp
        receiptId,                                       // B: Receipt Number
        finalKey,                                        // C: Idempotency Key
        finalHash,                                       // D: Request Hash
        sanitizeForSheet(v.fullName || ""),              // E: Full Name
        sanitizeForSheet(finalNim),                      // F: NIM
        sanitizeForSheet(v.birthPlace || ""),            // G: Place of Birth
        sanitizeForSheet(v.birthDate || ""),             // H: Date of Birth
        sanitizeForSheet(v.ugmEmail || ""),              // I: UGM Email
        sanitizeForSheet(v.phoneNumber || ""),           // J: Phone Number
        sanitizeForSheet(v.major || ""),                 // K: Study Program
        sanitizeForSheet(v.batch || ""),                 // L: Cohort / Batch
        sanitizeForSheet(v.division1 || ""),             // M: First Preference Division
        sanitizeForSheet(v.subDivision1 || ""),          // N: First Preference Sub-Division
        sanitizeForSheet(v.motivation1 || ""),           // O: First Preference Motivation
        sanitizeForSheet(v.division2 || ""),             // P: Second Preference Division
        sanitizeForSheet(v.subDivision2 || ""),          // Q: Second Preference Sub-Division
        sanitizeForSheet(v.motivation2 || ""),           // R: Second Preference Motivation
        docMap["cv"] || "",                              // S: CV
        docMap["idCard"] || "",                          // T: ID Card
        docMap["commitment"] || "",                      // U: Commitment Letter
        docMap["followProof"] || "",                     // V: Follow Proof
        docMap["storyProof"] || "",                      // W: Story Proof
        docMap["assignment1"] || "Tidak Diperlukan",     // X: Assignment 1
        folder.getUrl(),                                 // Y: Folder URL
        "SUBMITTED",                                     // Z: Status
        docMap["mbti"] || "",                            // AA: MBTI Result URL
        docMap["ugmGroupProof"] || ""                    // AB: UGM Group Sharing Proof URL
      ];

      sheet.appendRow(newRow);
      SpreadsheetApp.flush();
      lock.releaseLock();

      return jsonResponse({
        ok: true,
        status: "submitted",
        applicationId: receiptId
      });
    }

    // ACTION: cleanup
    if (action === "cleanup") {
      var cleanKey = payload.idempotencyKey;
      var cleanNim = String(payload.nim || "").toLowerCase().trim();
      var cleanName = String(payload.fullName || "").trim();

      // Only clean up if NOT submitted in Sheet
      var submittedCheck = findApplicationRow(sheet, 3, cleanKey);
      if (!submittedCheck || submittedCheck.rowData[25] !== "SUBMITTED") {
        var cleanFolder = getOrCreateApplicantFolder(rootFolder, cleanNim, cleanName, cleanKey);
        cleanFolder.setTrashed(true);
      }

      return jsonResponse({ ok: true, status: "cleaned" });
    }

    return jsonResponse({ ok: false, error: "Aksi tidak dikenali: " + action });
  } catch (err) {
    if (lock.hasLock()) {
      lock.releaseLock();
    }
    return jsonResponse({
      ok: false,
      error: err && err.message ? err.message : "Terjadi kesalahan internal pada Google Apps Script."
    });
  }
}
