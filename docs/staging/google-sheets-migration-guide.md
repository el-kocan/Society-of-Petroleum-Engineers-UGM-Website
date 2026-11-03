# SPE UGM SC — Google Sheets & Private Drive Migration Guide

## 1. Executive Summary & Architecture

This migration simplifies recruitment registration by replacing database approval workflows with a server-to-server integration:
```
Next.js Wizard (/join/apply)
  │
  ├── 1. POST /api/recruitment?action=init (JSON metadata < 5 KB)
  │      └─► Next.js validates Steps 0-2 & window; calls GAS init
  │
  ├── 2. POST /api/recruitment?action=upload (Multipart, 1 file per request <= 3.01 MB)
  │      └─► Next.js checks magic bytes, format, 4.5 MB Vercel limit; calls GAS upload_file
  │      (Repeated for all required files: CV, IDCard, Commitment, FollowProof, StoryProof, Assignment1)
  │
  ├── 3. POST /api/recruitment?action=finalize (JSON confirmation < 5 KB)
  │      └─► Next.js verifies file presence; calls GAS finalize
  │
  └── (On failure: cleans up incomplete folder; user retries safely)
  ▼
Google Apps Script Web App (scripts/google-apps-script/Code.gs)
  ├── LockService (15s concurrency lock)
  ├── Sanitizes inputs against spreadsheet formula injection (=, +, -, @, \t, \r)
  ├── Google Drive: Root Folder (Private) / [[NIM] FullName - ShortId] / [NIM]_Document.ext
  └── Google Sheets: "Applications" sheet (Private to committee)
```

Existing Supabase backend code and database remain 100% untouched as a fallback. Switching providers is controlled purely via `RECRUITMENT_PROVIDER=google_sheets`.

---

## 2. Practical Upload Limits & Vercel 4.5 MB Constraint

### The Vercel Serverless Request Limit
- **Vercel Functions hard limit**: Vercel enforces a strict **4.5 MB request body limit** on serverless functions.
- **Monolithic POST issue**: In the original implementation, the wizard attempted to send all 6 files (at up to 3 MiB each = up to 18 MiB binary) in a single multipart request. When total payload exceeded 4.5 MB, Vercel's edge proxy immediately rejected the request with `413 FUNCTION_PAYLOAD_TOO_LARGE` before reaching the application.

### The Staged Client-to-Next.js Transport
1. **`action=init`**: Submits personal info and preference choices as JSON (< 5 KiB). Next.js validates fields, checks dates, and checks for existing submissions / duplicate NIMs.
2. **`action=upload`**: Uploads **one file at a time** in separate requests. Each request body is at most 3.01 MB, strictly within Vercel's 4.5 MB limit. Next.js validates file format, magic bytes (PDF `%PDF-`/`%%EOF` without active content, PNG CRC & IHDR), and computes SHA-256 before forwarding to Google Apps Script.
3. **`action=finalize`**: Submits a final lightweight JSON request (< 5 KiB). Google Apps Script acquires an exclusive lock via `LockService`, writes the row into Google Sheets, marks status as `SUBMITTED`, and returns the official receipt ID (`SPE-2026-<NIM>-<ShortId>`).

---

## 3. Security, Privacy & Integrity Protections

1. **Spreadsheet Formula Injection Prevention**:
   - Google Apps Script sanitizes all text values using `sanitizeForSheet(val)`.
   - Any cell value starting with `=`, `+`, `-`, `@`, `\t`, or `\r` has a leading apostrophe `'` prepended. This forces Google Sheets / Excel to treat the cell as plain text, eliminating formula execution and exfiltration attacks.
2. **Private Google Drive Permissions**:
   - The root parent folder in Google Drive is created with **Restricted** sharing (committee members only).
   - All applicant subfolders and files created by Google Apps Script automatically inherit the restricted permissions of the parent folder.
   - Files are never set to public access (`ANYONE_WITH_LINK`). The browser never receives internal Drive links—only the confirmation receipt number.
3. **Server-Side Secret Authentication**:
   - The integration secret (`RECRUITMENT_APPS_SCRIPT_SECRET`) is server-only. It is never sent to or visible in the client browser.
   - Sent securely over HTTPS to the Google Apps Script Web App in `Authorization: Bearer <SECRET>` and verified against `API_SECRET` in Google Script Properties.
4. **Idempotency & Concurrency Safety**:
   - Google Apps Script uses `LockService.getScriptLock()` to serialize Sheet row writes.
   - Retrying with the same session key immediately returns the existing receipt without duplicate files or duplicate rows.
   - Duplicate NIMs under different session keys are rejected with HTTP 409 conflict.
5. **Disabled Recruitment Safety Guard**:
   - If `RECRUITMENT_ENABLED` and `RECRUITMENT_STAGING_ENABLED` are not `"true"`, the route immediately responds with 503 before any network call.

---

## 4. Google Spreadsheet Schema

- **Registration Dates**: November 4 – 13, 2026
- **Opening Timestamp**: `2026-11-04 00:00:00 Asia/Jakarta` (`2026-11-04T00:00:00+07:00`)
- **Public Deadline**: November 13, 2026 at 23:59 WIB
- **Technical Exclusive Cutoff**: `2026-11-14 00:00:00 Asia/Jakarta` (`2026-11-14T00:00:00+07:00`)
- **Spreadsheet Name**: `SPE UGM SC Recruitment 2026/2027`
- **Sheet (Tab) Name**: `Applications`

| Col | Header | Key / Type | Description / Example |
|---|---|---|---|
| A | Timestamp (WIB) | `timestamp` | Jakarta formatted time (`YYYY-MM-DD HH:mm:ss WIB`) |
| B | Receipt Number | `receipt_id` | `SPE-2026-SYNTHETIC-001-A1B2C3D4` |
| C | Idempotency Key | `idempotency_key` | Session UUID key from signed session |
| D | Request Hash | `request_hash` | SHA-256 hash of payload metadata and file hashes |
| E | Full Name | `full_name` | Applicant's full name (sanitized) |
| F | NIM | `nim` | Normalized student ID (lowercase/trimmed) |
| G | Place of Birth | `birth_place` | City / regency of birth (sanitized) |
| H | Date of Birth | `birth_date` | `YYYY-MM-DD` |
| I | UGM Email | `ugm_email` | Normalized UGM email (`@mail.ugm.ac.id`) |
| J | Phone Number | `phone_number` | WhatsApp reachable phone number |
| K | Study Program / Major | `major` | Study program / jurusan (sanitized) |
| L | Cohort / Batch | `batch` | `2025` or `2026` |
| M | First Preference - Division | `division1` | e.g. `Media Creative` |
| N | First Preference - Sub-Division | `subDivision1` | e.g. `Website Development` |
| O | First Preference - Motivation | `motivation1` | Motivation essay (sanitized) |
| P | Second Preference - Division | `division2` | e.g. `External Affairs` |
| Q | Second Preference - Sub-Division | `subDivision2` | e.g. `Relations & Partnership` |
| R | Second Preference - Motivation | `motivation2` | Motivation essay (sanitized) |
| S | CV Document URL | `cv_url` | Google Drive private file link |
| T | ID Card Document URL | `id_card_url` | Google Drive private file link |
| U | Commitment Letter URL | `commitment_url` | Google Drive private file link |
| V | Instagram Follow Proof URL | `follow_proof_url` | Google Drive private file link |
| W | Instagram Story Proof URL | `story_proof_url` | Google Drive private file link |
| X | First Preference Assignment URL | `assignment1_url` | Google Drive private file link (or "Tidak Diperlukan") |
| Y | Applicant Drive Folder URL | `folder_url` | Google Drive private link to applicant subfolder |
| Z | Status | `status` | `SUBMITTED` |

---

## 5. Google Drive Hierarchy & Naming Conventions

### Parent Folder (Root)
- **Folder Name**: `SPE UGM SC - Recruitment 2026-2027 (Submissions)`
- **Permissions**: Restricted (accessible only to authorized committee members). Never public.

### Applicant Subfolder
- **Folder Naming**: `[<NIM>] <Full Name> - <ShortSessionKey>`
- **Example**: `[123456] Budi Santoso - a1b2c3d4`
- **Permissions**: Inherits parent folder permissions (Restricted).

### Stored Files Inside Subfolder
- `[NIM]_CV.pdf`
- `[NIM]_IDCard.pdf`
- `[NIM]_LetterCommitment.pdf`
- `[NIM]_ProofFollowSPE.png`
- `[NIM]_ProofSG.png`
- `[NIM]_Assignment_FirstDivision.pdf` (if required by first preference)

---

## 6. Steps to Run Real Google Sheets / Drive Smoke Test

When ready to test with real Google resources:

### Step 1: Create Drive Folder & Spreadsheet (2 minutes)
1. In Google Drive, create a folder: `SPE UGM SC - Recruitment 2026-2027 (Submissions)`.
   - Copy the folder ID from the URL (`https://drive.google.com/drive/folders/<DRIVE_FOLDER_ID>`).
   - Keep sharing as **Restricted**.
2. Create a Google Spreadsheet: `SPE UGM SC Recruitment 2026/2027`.
   - Copy the spreadsheet ID from the URL (`https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`).

### Step 2: Deploy Google Apps Script (3 minutes)
1. In the Google Spreadsheet, go to **Extensions > Apps Script**.
2. Replace all contents in `Code.gs` with [`scripts/google-apps-script/Code.gs`](file:///d:/SPE%20UGM%20SC/spe-ugm-oprec-staging/scripts/google-apps-script/Code.gs).
3. Open **Project Settings** (gear icon) > **Script Properties** > **Add script property**:
   - `API_SECRET`: A secure random secret string (e.g. 32-48 hex characters).
   - `DRIVE_FOLDER_ID`: The Folder ID from Step 1.
   - `SPREADSHEET_ID`: The Spreadsheet ID from Step 1.
4. Click **Deploy > New deployment**:
   - Type: **Web app**.
   - Execute as: **Me** (the organizer account).
   - Who has access: **Anyone**.
   - Click **Deploy**, authorize permissions, and copy the **Web App URL** (`https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec`).

### Step 3: Run Local Smoke Test
In your local `.env.local`:
```ini
RECRUITMENT_PROVIDER=google_sheets
RECRUITMENT_ENABLED=true
RECRUITMENT_ORIGIN=http://localhost:3000
RECRUITMENT_SESSION_SECRET=<32+ char secret>
RECRUITMENT_APPS_SCRIPT_URL=https://script.google.com/macros/s/<YOUR_DEPLOYMENT_ID>/exec
RECRUITMENT_APPS_SCRIPT_SECRET=<YOUR_API_SECRET>
```
1. Run `pnpm dev`.
2. Open `http://localhost:3000/join/apply`.
3. Fill out the 4-step wizard with test data and attach sample PDFs/PNGs.
4. Click **Submit application**.
5. Verify:
   - Success screen appears with confirmation receipt number (`SPE-2026-...`).
   - Google Spreadsheet has a new row in the `Applications` tab.
   - Google Drive has a private applicant subfolder containing the uploaded files.
   - File links in the sheet open the respective files in Google Drive.
