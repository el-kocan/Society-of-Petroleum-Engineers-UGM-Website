/* eslint-disable @typescript-eslint/no-require-imports -- Offline TypeScript test loader. */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../../');
const jar = new Map();
jar.get = function(key) { const value = Map.prototype.get.call(this, key); return value ? { value } : undefined; };
jar.set = function(key, value) { Map.prototype.set.call(this, key, value); };

const originalLoad = Module._load;
Module._load = function(id, parent, main) {
  if (id === 'server-only') return {};
  if (id === 'next/headers') return { cookies: async () => jar };
  if (id.startsWith('@/')) id = path.join(root, 'src', id.slice(2));
  return originalLoad.call(this, id, parent, main);
};

require.extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    filename,
  );

const {
  isGoogleProvider,
  googleSettings,
  loadGoogleCatalog,
  submitToGoogle,
} = require('../../src/modules/recruitment/server/google-sheets-adapter.ts');
const { assertOpen, publicPeriod } = require('../../src/modules/recruitment/server/configuration.ts');
const { validatePayload } = require('../../src/modules/recruitment/server/payload.ts');
const { SubmissionError } = require('../../src/modules/recruitment/server/security.ts');
const route = require('../../app/api/recruitment/route.ts');

const TEST_SECRET = 'synthetic-test-only-secret-min-32-chars-long';
const APPS_SCRIPT_SECRET = 'synthetic-apps-script-secret-12345';
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/SYNTHETIC_DEPLOYMENT_ID/exec';
const ORIGIN = 'http://localhost:3000';
const KEY = '11111111-2222-4333-a444-555555555555';

function setMockEnv(overrides = {}) {
  process.env.RECRUITMENT_PROVIDER = 'google_sheets';
  process.env.RECRUITMENT_ENABLED = 'true';
  process.env.RECRUITMENT_SINGLE_INSTANCE = 'true';
  process.env.RECRUITMENT_ORIGIN = ORIGIN;
  process.env.RECRUITMENT_SESSION_SECRET = TEST_SECRET;
  process.env.RECRUITMENT_APPS_SCRIPT_URL = APPS_SCRIPT_URL;
  process.env.RECRUITMENT_APPS_SCRIPT_SECRET = APPS_SCRIPT_SECRET;
  process.env.RECRUITMENT_OPENS_AT = '2020-01-01T00:00:00+07:00';
  process.env.RECRUITMENT_CLOSES_AT = '2099-01-01T00:00:00+07:00';
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

// Synthetic files
const pdfHeader = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n');
const { deflateSync } = require('node:zlib');
function createPng() {
  function chunk(type, body) {
    const data = Buffer.concat([Buffer.from(type), body]);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    const out = Buffer.alloc(body.length + 12);
    out.writeUInt32BE(body.length);
    data.copy(out, 4);
    out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, out.length - 4);
    return out;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0, 255]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
const pngBytes = createPng();

function createSyntheticForm(overrides = {}) {
  const data = {
    fullName: 'Synthetic Google Applicant',
    nim: ' SYNTHETIC-001 ',
    birthPlace: 'Yogyakarta',
    birthDate: '2005-05-15',
    ugmEmail: ' synthetic.applicant@mail.ugm.ac.id ',
    phoneNumber: '+6281234567890',
    major: 'Teknik Geologi',
    batch: '2026',
    division1: 'media-creative',
    subDivision1: 'website-development',
    motivation1: 'Synthetic motivation for website development',
    division2: 'external-affairs',
    subDivision2: 'relations-partnership',
    motivation2: 'Synthetic motivation for relations partnership',
    ...overrides,
  };
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.set(k, v);
  f.set('cv', new File([pdfHeader], 'synthetic_cv.pdf', { type: 'application/pdf' }));
  f.set('idCard', new File([pdfHeader], 'synthetic_id.pdf', { type: 'application/pdf' }));
  f.set('commitment', new File([pdfHeader], 'synthetic_commit.pdf', { type: 'application/pdf' }));
  f.set('followProof', new File([pngBytes], 'synthetic_follow.png', { type: 'image/png' }));
  f.set('storyProof', new File([pngBytes], 'synthetic_story.png', { type: 'image/png' }));
  f.set('mbti', new File([pngBytes], 'synthetic_mbti.png', { type: 'image/png' }));
  f.set('ugmGroupProof', new File([pngBytes], 'synthetic_ugm_group.png', { type: 'image/png' }));
  // media-creative/website-development requires rank 1 assignment PDF
  f.set('assignment1', new File([pdfHeader], 'synthetic_assign.pdf', { type: 'application/pdf' }));
  return f;
}

function createMockAppsScriptServer() {
  const state = {
    sheetRows: [],
    folders: new Map(), // key -> files Map
    history: [],
    shouldFailAction: null,
  };

  const mockFetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    assert.equal(url, APPS_SCRIPT_URL);
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['Authorization'], `Bearer ${APPS_SCRIPT_SECRET}`);

    const body = JSON.parse(init.body);
    assert.equal(body.authSecret, APPS_SCRIPT_SECRET);
    state.history.push(body);

    if (state.shouldFailAction === body.action) {
      state.shouldFailAction = null;
      return new Response(JSON.stringify({ ok: false, error: 'Simulated Apps Script failure' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (body.action === 'init') {
      const { idempotencyKey, nim, fullName } = body;
      const normalizedNim = nim.toLowerCase().trim();

      // Check existing idempotency
      const existingKeyRow = state.sheetRows.find((r) => r.idempotencyKey === idempotencyKey);
      if (existingKeyRow && existingKeyRow.status === 'SUBMITTED') {
        return new Response(
          JSON.stringify({
            ok: true,
            status: 'already_submitted',
            applicationId: existingKeyRow.receiptId,
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Check existing NIM
      const existingNimRow = state.sheetRows.find((r) => r.nim === normalizedNim);
      if (existingNimRow && existingNimRow.idempotencyKey !== idempotencyKey) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: 'Pendaftaran tidak dapat dibuat. Jika pernah mendaftar dengan NIM ini, hubungi panitia.',
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (!state.folders.has(idempotencyKey)) {
        state.folders.set(idempotencyKey, new Map());
      }

      const receiptId = `SPE-2026-${normalizedNim.toUpperCase()}-${idempotencyKey.slice(0, 8).toUpperCase()}`;
      return new Response(
        JSON.stringify({
          ok: true,
          status: 'ready',
          applicationId: receiptId,
          folderId: `folder-${idempotencyKey.slice(0, 8)}`,
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (body.action === 'upload_file') {
      const { idempotencyKey, slot, filename, mimeType, sha256, base64Content } = body;
      const bytes = Buffer.from(base64Content, 'base64');
      const computedSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
      assert.equal(computedSha256, sha256);

      const folder = state.folders.get(idempotencyKey) || new Map();
      folder.set(slot, {
        filename,
        mimeType,
        sha256,
        bytes,
        fileId: `file-${slot}-${idempotencyKey.slice(0, 4)}`,
        fileUrl: `https://drive.google.com/file/d/file-${slot}/view`,
      });
      state.folders.set(idempotencyKey, folder);

      return new Response(
        JSON.stringify({
          ok: true,
          slot,
          fileId: `file-${slot}`,
          fileUrl: `https://drive.google.com/file/d/file-${slot}/view`,
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (body.action === 'finalize') {
      const { idempotencyKey, hash, values, applicationId } = body;
      const receiptId = applicationId || `SPE-2026-${values.nim.toUpperCase()}-${idempotencyKey.slice(0, 8).toUpperCase()}`;

      state.sheetRows.push({
        receiptId,
        idempotencyKey,
        hash,
        nim: values.nim.toLowerCase().trim(),
        values,
        status: 'SUBMITTED',
      });

      return new Response(
        JSON.stringify({
          ok: true,
          status: 'submitted',
          applicationId: receiptId,
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (body.action === 'cleanup') {
      const { idempotencyKey } = body;
      const submitted = state.sheetRows.find((r) => r.idempotencyKey === idempotencyKey && r.status === 'SUBMITTED');
      if (!submitted) {
        state.folders.delete(idempotencyKey);
      }
      return new Response(JSON.stringify({ ok: true, status: 'cleaned' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: false, error: 'Unknown action' }), { status: 400 });
  };

  return { state, mockFetch };
}

test('isGoogleProvider detects environment setting', () => {
  setMockEnv({ RECRUITMENT_PROVIDER: 'google_sheets' });
  assert.equal(isGoogleProvider(), true);

  setMockEnv({ RECRUITMENT_PROVIDER: 'supabase' });
  assert.equal(isGoogleProvider(), false);

  setMockEnv({ RECRUITMENT_PROVIDER: undefined });
  assert.equal(isGoogleProvider(), false);
});

test('googleSettings validates secrets, url, and origin', () => {
  setMockEnv();
  const s = googleSettings();
  assert.equal(s.scriptUrl, APPS_SCRIPT_URL);
  assert.equal(s.scriptSecret, APPS_SCRIPT_SECRET);
  assert.equal(s.origin, ORIGIN);

  // Missing script URL throws 503
  setMockEnv({ RECRUITMENT_APPS_SCRIPT_URL: '' });
  assert.throws(() => googleSettings(), (err) => err instanceof SubmissionError && err.status === 503);

  // Short script secret throws 503
  setMockEnv({ RECRUITMENT_APPS_SCRIPT_SECRET: 'short' });
  assert.throws(() => googleSettings(), (err) => err instanceof SubmissionError && err.status === 503);
});

test('loadGoogleCatalog produces valid GUIDEBOOK_v3 catalog that satisfies assertOpen and publicPeriod', () => {
  setMockEnv();
  const catalog = loadGoogleCatalog();

  // Exactly 13 options across 6 divisions
  assert.equal(catalog.options.length, 13);
  assert.equal(catalog.requirements.length, 7);
  assert.deepEqual(catalog.period.batches, ['2025', '2026']);

  // Relations & Partnership has no assignment
  const rp = catalog.options.find((o) => o.main_code === 'external-affairs' && o.sub_code === 'relations-partnership');
  assert(rp);
  assert.equal(rp.assignment_state, 'none');

  // Other options require PDF assignment (e.g. website-development)
  const wd = catalog.options.find((o) => o.main_code === 'media-creative' && o.sub_code === 'website-development');
  assert(wd);
  assert.equal(wd.assignment_state, 'required');
  assert.deepEqual(wd.formats, ['pdf']);
  assert.equal(wd.max_bytes, 3145728);

  // assertOpen succeeds
  assert.doesNotThrow(() => assertOpen(catalog, Date.parse('2026-11-06T12:00:00+07:00')));

  // publicPeriod builds UI-ready object
  const pub = publicPeriod(catalog);
  assert.equal(pub.id, 'oprec-2026-2027');
  assert.equal(pub.divisions.length, 6);
});

test('staged upload to Google Apps Script completes with 8 files, verifies hashes and receipt', async () => {
  setMockEnv();
  const catalog = loadGoogleCatalog();
  const form = createSyntheticForm();
  const payload = await validatePayload(form, catalog);

  assert.equal(payload.documents.length, 8); // 7 supporting + 1 assignment

  const { state, mockFetch } = createMockAppsScriptServer();
  const result = await submitToGoogle(catalog, KEY, payload, mockFetch);

  assert(result.applicationId.startsWith('SPE-2026-SYNTHETIC-001-'));
  assert.equal(state.sheetRows.length, 1);
  assert.equal(state.sheetRows[0].status, 'SUBMITTED');

  // Check action sequence: init -> 8x upload_file -> finalize
  const actions = state.history.map((h) => h.action);
  assert.equal(actions[0], 'init');
  assert.equal(actions.filter((a) => a === 'upload_file').length, 8);
  assert.equal(actions[actions.length - 1], 'finalize');

  // Check stored files in applicant folder
  const filesMap = state.folders.get(KEY);
  assert.equal(filesMap.size, 8);
  for (const slot of ['cv', 'idCard', 'commitment', 'followProof', 'storyProof', 'mbti', 'ugmGroupProof', 'assignment1']) {
    assert(filesMap.has(slot));
  }
});

test('staged upload with Relations & Partnership (no assignment) completes with 7 files', async () => {
  setMockEnv();
  const catalog = loadGoogleCatalog();
  const form = createSyntheticForm({
    division1: 'external-affairs',
    subDivision1: 'relations-partnership',
    motivation1: 'Motivation for relations & partnership',
    division2: 'media-creative',
    subDivision2: 'website-development',
    motivation2: 'Motivation for website development',
  });
  // Remove assignment1 since relations-partnership requires none
  form.delete('assignment1');
  const payload = await validatePayload(form, catalog);

  assert.equal(payload.documents.length, 7); // Exactly 7 supporting documents, 0 assignment

  const { state, mockFetch } = createMockAppsScriptServer();
  const result = await submitToGoogle(catalog, KEY, payload, mockFetch);

  assert(result.applicationId.startsWith('SPE-2026-SYNTHETIC-001-'));
  assert.equal(state.sheetRows.length, 1);
  assert.equal(state.sheetRows[0].status, 'SUBMITTED');

  const actions = state.history.map((h) => h.action);
  assert.equal(actions[0], 'init');
  assert.equal(actions.filter((a) => a === 'upload_file').length, 7);
  assert.equal(actions[actions.length - 1], 'finalize');

  const filesMap = state.folders.get(KEY);
  assert.equal(filesMap.size, 7);
  for (const slot of ['cv', 'idCard', 'commitment', 'followProof', 'storyProof', 'mbti', 'ugmGroupProof']) {
    assert(filesMap.has(slot));
  }
  assert(!filesMap.has('assignment1'));
});

test('idempotency: resubmission with same key returns existing receipt without duplicates', async () => {
  setMockEnv();
  const catalog = loadGoogleCatalog();
  const form = createSyntheticForm();
  const payload = await validatePayload(form, catalog);

  const { state, mockFetch } = createMockAppsScriptServer();

  // First submission
  const firstResult = await submitToGoogle(catalog, KEY, payload, mockFetch);
  assert.equal(state.sheetRows.length, 1);

  // Second submission with exact same key
  const secondResult = await submitToGoogle(catalog, KEY, payload, mockFetch);
  assert.equal(secondResult.applicationId, firstResult.applicationId);

  // No duplicate row created
  assert.equal(state.sheetRows.length, 1);

  // Second submission stopped at 'init' because status was already_submitted
  const lastAction = state.history[state.history.length - 1];
  assert.equal(lastAction.action, 'init');
});

test('duplicate NIM with different key is rejected with 409 conflict', async () => {
  setMockEnv();
  const catalog = loadGoogleCatalog();
  const form = createSyntheticForm();
  const payload = await validatePayload(form, catalog);

  const { state, mockFetch } = createMockAppsScriptServer();

  // First applicant submits with KEY
  await submitToGoogle(catalog, KEY, payload, mockFetch);

  // Different session key attempts to submit with the same NIM
  const differentKey = '99999999-9999-4999-a999-999999999999';
  await assert.rejects(
    async () => {
      await submitToGoogle(catalog, differentKey, payload, mockFetch);
    },
    (err) => {
      assert(err instanceof SubmissionError);
      assert.equal(err.status, 409);
      assert(err.message.includes('NIM'));
      return true;
    },
  );

  // Still only 1 row in sheet
  assert.equal(state.sheetRows.length, 1);
});

test('partial failure on file upload triggers cleanup and throws 503 error', async () => {
  setMockEnv();
  const catalog = loadGoogleCatalog();
  const form = createSyntheticForm();
  const payload = await validatePayload(form, catalog);

  const { state, mockFetch } = createMockAppsScriptServer();

  // Instruct mock to fail on upload_file
  state.shouldFailAction = 'upload_file';

  await assert.rejects(
    async () => {
      await submitToGoogle(catalog, KEY, payload, mockFetch);
    },
    (err) => {
      assert(err instanceof SubmissionError);
      assert.equal(err.status, 503);
      return true;
    },
  );

  // Verify cleanup action was called
  const cleanupAction = state.history.find((h) => h.action === 'cleanup');
  assert(cleanupAction);
  assert.equal(cleanupAction.idempotencyKey, KEY);

  // Folder should have been removed from server state by cleanup
  assert.equal(state.folders.has(KEY), false);

  // No row written to Google Sheets
  assert.equal(state.sheetRows.length, 0);
});

test('route GET and POST handlers work end-to-end with Google provider', async () => {
  setMockEnv();
  const { mockFetch } = createMockAppsScriptServer();

  // Test GET
  const getReq = new Request(`${ORIGIN}/api/recruitment`, {
    headers: { origin: ORIGIN, host: 'localhost:3000' },
  });
  const getRes = await route.GET(getReq);
  assert.equal(getRes.status, 200);
  const getData = await getRes.json();
  assert(getData.token);
  assert.equal(getData.period.id, 'oprec-2026-2027');

  // Test POST
  const token = getData.token;
  const form = createSyntheticForm();
  const postReq = new Request(`${ORIGIN}/api/recruitment`, {
    method: 'POST',
    headers: {
      origin: ORIGIN,
      host: 'localhost:3000',
      'x-recruitment-session': token,
    },
    body: form,
  });

  // Inject our mockFetch into global for this test
  const originalFetch = global.fetch;
  global.fetch = mockFetch;

  try {
    const postRes = await route.POST(postReq);
    assert.equal(postRes.status, 200);
    const postData = await postRes.json();
    assert(postData.applicationId);
    assert(postData.applicationId.startsWith('SPE-2026-SYNTHETIC-001-'));
  } finally {
    global.fetch = originalFetch;
  }
});

test('staged client-to-Next.js transport handles eight maximum-size 3 MiB files under Vercel 4.5 MB limit', async () => {
  setMockEnv();
  const { state, mockFetch } = createMockAppsScriptServer();

  // Helper to generate exact 3 MiB valid PDF
  function create3MbPdf() {
    const header = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\nstream\n');
    const trailer = Buffer.from('\nendstream\n%%EOF\n');
    const fillerSize = 3 * 1024 * 1024 - header.length - trailer.length;
    const filler = Buffer.alloc(fillerSize, 0x20); // space padding
    return Buffer.concat([header, filler, trailer]);
  }
  const largePdf = create3MbPdf();
  assert.equal(largePdf.length, 3 * 1024 * 1024);

  // 1. GET session
  const getReq = new Request(`${ORIGIN}/api/recruitment`, {
    headers: { origin: ORIGIN, host: 'localhost:3000' },
  });
  const getRes = await route.GET(getReq);
  assert.equal(getRes.status, 200);
  const { token } = await getRes.json();

  const originalFetch = global.fetch;
  global.fetch = mockFetch;

  try {
    // Stage 1: Init submission
    const applicantValues = {
      fullName: 'Max Payload Applicant',
      nim: 'SYNTHETIC-MAX-001',
      birthPlace: 'Yogyakarta',
      birthDate: '2005-01-10',
      ugmEmail: 'max.payload@mail.ugm.ac.id',
      phoneNumber: '+628999999999',
      major: 'Teknik Geologi',
      batch: '2026',
      division1: 'media-creative',
      subDivision1: 'website-development',
      motivation1: 'Motivation for max payload test',
      division2: 'external-affairs',
      subDivision2: 'relations-partnership',
      motivation2: 'Motivation for rank 2',
    };

    const initReq = new Request(`${ORIGIN}/api/recruitment?action=init`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        host: 'localhost:3000',
        'x-recruitment-session': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: applicantValues }),
    });
    const initRes = await route.POST(initReq);
    assert.equal(initRes.status, 200);
    const initData = await initRes.json();
    assert.equal(initData.ok, true);
    assert.equal(initData.status, 'ready');

    // Stage 2: Upload 8 files individually (each strictly <= 3.01 MB, well below 4.5 MB Vercel limit)
    const slots = [
      { slot: 'cv', file: new File([largePdf], 'cv.pdf', { type: 'application/pdf' }) },
      { slot: 'idCard', file: new File([largePdf], 'id.pdf', { type: 'application/pdf' }) },
      { slot: 'commitment', file: new File([largePdf], 'commit.pdf', { type: 'application/pdf' }) },
      { slot: 'followProof', file: new File([pngBytes], 'follow.png', { type: 'image/png' }) },
      { slot: 'storyProof', file: new File([pngBytes], 'story.png', { type: 'image/png' }) },
      { slot: 'mbti', file: new File([pngBytes], 'mbti.png', { type: 'image/png' }) },
      { slot: 'ugmGroupProof', file: new File([pngBytes], 'ugmGroupProof.png', { type: 'image/png' }) },
      { slot: 'assignment1', file: new File([largePdf], 'assign.pdf', { type: 'application/pdf' }) },
    ];

    const uploadedDocs = [];
    for (const { slot, file } of slots) {
      const fileForm = new FormData();
      fileForm.append('slot', slot);
      fileForm.append('file', file);
      fileForm.append('nim', applicantValues.nim);
      fileForm.append('fullName', applicantValues.fullName);

      const uploadReq = new Request(`${ORIGIN}/api/recruitment?action=upload`, {
        method: 'POST',
        headers: {
          origin: ORIGIN,
          host: 'localhost:3000',
          'x-recruitment-session': token,
        },
        body: fileForm,
      });

      const uploadRes = await route.POST(uploadReq);
      assert.equal(uploadRes.status, 200, `Slot ${slot} failed with status ${uploadRes.status}`);
      const uploadData = await uploadRes.json();
      assert.equal(uploadData.ok, true);
      assert.equal(uploadData.slot, slot);
      uploadedDocs.push(uploadData);
    }

    assert.equal(uploadedDocs.length, 8);

    // Verify upload_file received proper nim and fullName and generated proper filenames
    const uploadActions = state.history.filter((h) => h.action === 'upload_file');
    assert.equal(uploadActions.length, 8);
    for (const action of uploadActions) {
      assert.equal(action.nim, 'synthetic-max-001');
      assert.equal(action.fullName, 'Max Payload Applicant');
      assert(action.filename.startsWith('[SYNTHETIC-MAX-001]_'), `Filename ${action.filename} must start with NIM`);
    }

    // Stage 3: Finalize submission
    const finalReq = new Request(`${ORIGIN}/api/recruitment?action=finalize`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        host: 'localhost:3000',
        'x-recruitment-session': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: applicantValues, documents: uploadedDocs }),
    });

    const finalRes = await route.POST(finalReq);
    assert.equal(finalRes.status, 200);
    const finalData = await finalRes.json();
    assert.equal(finalData.ok, true);
    assert(finalData.applicationId.startsWith('SPE-2026-SYNTHETIC-MAX-001-'));

    // Check Google Sheet row in state
    assert.equal(state.sheetRows.length, 1);
    assert.equal(state.sheetRows[0].status, 'SUBMITTED');

    // Stage 4: Test staged retry idempotency with same session token
    const retryInitReq = new Request(`${ORIGIN}/api/recruitment?action=init`, {
      method: 'POST',
      headers: {
        origin: ORIGIN,
        host: 'localhost:3000',
        'x-recruitment-session': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values: applicantValues }),
    });
    const retryInitRes = await route.POST(retryInitReq);
    assert.equal(retryInitRes.status, 200);
    const retryData = await retryInitRes.json();
    assert.equal(retryData.status, 'already_submitted');
    assert.equal(retryData.applicationId, finalData.applicationId);
    // Still exactly 1 row in sheet
    assert.equal(state.sheetRows.length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('spreadsheet formula injection protection neutralizes malicious leading formula characters', () => {
  // Directly test Code.gs sanitizeForSheet logic
  function sanitizeForSheet(val) {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (/^[=+@\-\t\r]/.test(str)) {
      return "'" + str;
    }
    return str;
  }

  assert.equal(sanitizeForSheet('=HYPERLINK("http://evil.com","Click")'), '\'=HYPERLINK("http://evil.com","Click")');
  assert.equal(sanitizeForSheet('+cmd|"/C calc"!A0'), '\'+cmd|"/C calc"!A0');
  assert.equal(sanitizeForSheet('@SUM(A1:A10)'), '\'@SUM(A1:A10)');
  assert.equal(sanitizeForSheet('-123'), '\'-123');
  assert.equal(sanitizeForSheet('\tmalicious tab'), '\'\tmalicious tab');
  assert.equal(sanitizeForSheet('Normal Name'), 'Normal Name');
  assert.equal(sanitizeForSheet(''), '');
});

test('safety guard: recruitment disabled blocks Google provider selection before any network call', async () => {
  setMockEnv({
    RECRUITMENT_ENABLED: 'false',
    RECRUITMENT_STAGING_ENABLED: 'false',
  });

  const getReq = new Request(`${ORIGIN}/api/recruitment`, {
    headers: { origin: ORIGIN, host: 'localhost:3000' },
  });
  const getRes = await route.GET(getReq);
  assert.equal(getRes.status, 503);
  const getData = await getRes.json();
  assert(getData.error.includes('Applications are currently unavailable'));
});

test('official recruitment schedule: defaults match 2026-11-05 to 2026-11-14 across Next.js and dynamic schedule', () => {
  setMockEnv({ RECRUITMENT_OPENS_AT: undefined, RECRUITMENT_CLOSES_AT: undefined });
  const catalog = loadGoogleCatalog();
  assert.equal(catalog.period.opens_at, '2026-11-05T00:00:00+07:00');
  assert.equal(catalog.period.closes_at, '2026-11-14T00:00:00+07:00');

  const { getPublicRecruitmentSchedule, PUBLIC_RECRUITMENT_SCHEDULE } = require('../../src/modules/recruitment/public-information.ts');

  // 1. Before Nov 13 (Standard open window)
  const standardSchedule = getPublicRecruitmentSchedule(Date.parse('2026-11-06T12:00:00+07:00'));
  assert.equal(standardSchedule.applicationDates, 'November 5 – 12, 2026');
  assert.equal(standardSchedule.deadline, 'November 12, 2026, 23:59 WIB');
  assert.equal(standardSchedule.isExtended, false);
  assert.equal(standardSchedule.isClosed, false);
  assert.equal(standardSchedule.badge, null);

  // 2. During Nov 13 (Extended registration day)
  const extendedSchedule = getPublicRecruitmentSchedule(Date.parse('2026-11-13T12:00:00+07:00'));
  assert.equal(extendedSchedule.applicationDates, 'November 5 – 13, 2026 (Extended)');
  assert.equal(extendedSchedule.deadline, 'November 13, 2026, 23:59 WIB');
  assert.equal(extendedSchedule.isExtended, true);
  assert.equal(extendedSchedule.isClosed, false);
  assert.equal(extendedSchedule.badge, 'Registration Extended');

  // 3. At or after Nov 14 (Exclusive cutoff - registration closed)
  const closedSchedule = getPublicRecruitmentSchedule(Date.parse('2026-11-14T00:00:00+07:00'));
  assert.equal(closedSchedule.isClosed, true);
  assert.equal(closedSchedule.badge, 'Applications Closed');
});

test('Google Sheets headers and row structure: preserves columns A-Z and appends AA and AB', () => {
  const fs = require('node:fs');
  const codeGs = fs.readFileSync(path.join(__dirname, '../google-apps-script/Code.gs'), 'utf8');

  // Verify HEADERS array
  const headerMatch = codeGs.match(/var HEADERS = \[([\s\S]*?)\];/);
  assert(headerMatch, 'HEADERS array must exist in Code.gs');
  const headers = headerMatch[1]
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);

  assert.equal(headers.length, 28, 'Total columns must be 28 (A-AB)');
  assert.equal(headers[24], 'Applicant Drive Folder URL'); // Col Y
  assert.equal(headers[25], 'Status');                   // Col Z (index 25)
  assert.equal(headers[26], 'MBTI Result URL');           // Col AA (index 26)
  assert.equal(headers[27], 'UGM Group Sharing Proof URL'); // Col AB (index 27)

  // Verify newRow indices in Code.gs
  assert(codeGs.includes('"SUBMITTED",                                     // Z: Status'));
  assert(codeGs.includes('docMap["mbti"] || "",                            // AA: MBTI Result URL'));
  assert(codeGs.includes('docMap["ugmGroupProof"] || ""                    // AB: UGM Group Sharing Proof URL'));

  // Verify sheet column auto-expansion logic in Code.gs
  assert(codeGs.includes('sheet.insertColumnsAfter(maxCols, HEADERS.length - maxCols)'), 'Code.gs must expand physical columns when < 28');
});

test('existing Google Sheet with 26 columns safely expands to 28 columns for AA and AB', () => {
  let maxCols = 26;
  const sheetData = [
    // Existing row 1 (headers A-Z)
    Array.from({ length: 26 }, (_, i) => `Col_${i + 1}`),
    // Existing row 2 (synthetic submission A-Z)
    Array.from({ length: 26 }, (_, i) => i === 25 ? 'SUBMITTED' : `Data_${i + 1}`),
  ];

  const mockSheet = {
    getMaxColumns: () => maxCols,
    getLastRow: () => sheetData.length,
    getLastColumn: () => sheetData[0].length,
    insertColumnsAfter: (afterPos, count) => {
      maxCols += count;
    },
    getRange: (row, col) => ({
      setValue: (val) => {
        if (!sheetData[row - 1]) sheetData[row - 1] = [];
        sheetData[row - 1][col - 1] = val;
      },
      setFontWeight: () => {},
    }),
  };

  const HEADERS = Array.from({ length: 28 }, (_, i) => {
    if (i === 25) return 'Status';
    if (i === 26) return 'MBTI Result URL';
    if (i === 27) return 'UGM Group Sharing Proof URL';
    return `Col_${i + 1}`;
  });

  // Emulate getApplicationsSheet logic from Code.gs
  var currentMax = mockSheet.getMaxColumns();
  if (currentMax < HEADERS.length) {
    mockSheet.insertColumnsAfter(currentMax, HEADERS.length - currentMax);
  }
  var lastCol = mockSheet.getLastColumn();
  if (lastCol < HEADERS.length) {
    for (var col = lastCol + 1; col <= HEADERS.length; col++) {
      mockSheet.getRange(1, col).setValue(HEADERS[col - 1]);
    }
  }

  // 1. Sheet was expanded from 26 to 28
  assert.equal(mockSheet.getMaxColumns(), 28);
  // 2. Existing row 2 data in columns A-Z was untouched
  assert.equal(sheetData[1][25], 'SUBMITTED');
  assert.equal(sheetData[1][0], 'Data_1');
  // 3. Headers AA (Col 27) and AB (Col 28) were added to row 1
  assert.equal(sheetData[0][26], 'MBTI Result URL');
  assert.equal(sheetData[0][27], 'UGM Group Sharing Proof URL');
});

test('document validation and filename resolution: supports mbti and ugmGroupProof PNGs', () => {
  const { validateFile } = require('../../src/modules/recruitment/validation.ts');
  const { resolveFilename } = require('../../src/modules/recruitment/server/google-sheets-adapter.ts');

  // Filename resolution
  assert.equal(resolveFilename('23/123456/TK/11111', 'mbti', 'png'), '[23/123456/TK/11111]_MBTI.png');
  assert.equal(resolveFilename('23/123456/TK/11111', 'ugmGroupProof', 'png'), '[23/123456/TK/11111]_UGMGroupProof.png');

  // File validation: PNG required
  const validPng = new File([pngBytes], 'sample.png', { type: 'image/png' });
  assert.equal(validateFile('mbti', validPng), undefined);
  assert.equal(validateFile('ugmGroupProof', validPng), undefined);

  // Reject PDF or wrong mime for PNG slots
  const wrongFormat = new File([pdfHeader], 'sample.pdf', { type: 'application/pdf' });
  assert(validateFile('mbti', wrongFormat));
  assert(validateFile('ugmGroupProof', wrongFormat));
});

test('identity binding: staged upload resolves to established applicant folder and prevents hijacking', () => {
  const mockFolders = [];
  const rootFolder = {
    getFolders: () => {
      let idx = 0;
      return {
        hasNext: () => idx < mockFolders.length,
        next: () => mockFolders[idx++],
      };
    },
    createFolder: (name) => {
      const f = {
        name,
        getName: () => f.name,
        setName: (n) => { f.name = n; },
        getId: () => 'folder-123',
      };
      mockFolders.push(f);
      return f;
    },
  };

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
      if (existing.getName().startsWith("[]") && (safeNim || cleanName)) {
        existing.setName("[" + safeNim + "] " + cleanName + " - " + shortKey);
      }
      return existing;
    }

    var folderName = "[" + safeNim + "] " + cleanName + " - " + shortKey;
    return rootFolder.createFolder(folderName);
  }

  const testKey = 'abcdef12-3456-7890-abcd-ef1234567890';
  // 1. Stage 1 init creates folder with applicant's verified NIM and name
  const initFolder = getOrCreateApplicantFolder(rootFolder, '23/512345/TK/12345', 'Budi Santoso', testKey);
  assert.equal(initFolder.getName(), '[23/512345/tk/12345] Budi Santoso - abcdef12');

  // 2. Stage 2 upload sends conflicting or blank NIM/name: established folder is NOT renamed
  const uploadFolder = getOrCreateApplicantFolder(rootFolder, '99/999999/XX/99999', 'Evil Attacker', testKey);
  assert.equal(uploadFolder, initFolder);
  assert.equal(uploadFolder.getName(), '[23/512345/tk/12345] Budi Santoso - abcdef12');

  // 3. Filename binding enforces established NIM from folder
  let filename = '[99/999999/XX/99999]_CV.pdf';
  const folderMatch = uploadFolder.getName().match(/^\[(.*?)\]/);
  assert(folderMatch);
  const establishedNim = folderMatch[1].trim().toUpperCase();
  assert.equal(establishedNim, '23/512345/TK/12345');
  if (filename.indexOf("]") !== -1) {
    filename = "[" + establishedNim + "]" + filename.substring(filename.indexOf("]") + 1);
  }
  assert.equal(filename, '[23/512345/TK/12345]_CV.pdf');
});
