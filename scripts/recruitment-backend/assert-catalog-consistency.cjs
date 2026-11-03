/**
 * B9 Phase 3 — Catalog Consistency Assertions
 *
 * Verifies that the staging SQL configuration script matches
 * the canonical division/sub-division catalog in draft-config.ts,
 * landing.tsx, config.ts (documentSlots), and the GUIDEBOOK_v3
 * assignment policy.
 *
 * Run: node scripts/recruitment-backend/assert-catalog-consistency.cjs
 */
"use strict";

const { readFileSync } = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "../..");

// === 1. Parse canonical catalog from draft-config.ts ===

const draftSrc = readFileSync(path.join(root, "src/modules/recruitment/draft-config.ts"), "utf8");

// Extract division calls: division("id", "label", [...])
const divisionCalls = [...draftSrc.matchAll(/division\("([^"]+)",\s*"([^"]+)",\s*\[([\s\S]*?)\]\)/g)];
assert.equal(divisionCalls.length, 6, "draft-config.ts must define exactly 6 divisions");

const canonical = [];
for (const [, mainCode, mainLabel, childBlock] of divisionCalls) {
  const children = [...childBlock.matchAll(/\["([^"]+)",\s*"([^"]+)"\]/g)];
  assert.ok(children.length > 0, `Division ${mainCode} must have at least one sub-division`);
  for (const [, subCode, subLabel] of children) {
    canonical.push({ mainCode, subCode, mainLabel, subLabel });
  }
}
assert.equal(canonical.length, 13, "draft-config.ts must define exactly 13 sub-divisions");
console.log(`  OK: draft-config.ts has 6 divisions, 13 sub-divisions`);

// === 2. Verify assignment policy from draft-config.ts ===

// relations-partnership should get noneAssignment
assert.ok(
  draftSrc.includes('childId === "relations-partnership" ? noneAssignment : requiredAssignment'),
  "Assignment logic must route relations-partnership to noneAssignment"
);
console.log(`  OK: relations-partnership mapped to noneAssignment, all others to requiredAssignment`);

// === 3. Parse and verify SQL configuration script ===

const sqlSrc = readFileSync(
  path.join(root, "scripts/recruitment-backend/guidebook-v3-staging-config.sql"),
  "utf8"
);

// Extract all (main_code, sub_code, main_label, sub_label, assignment_state) from VALUES
// Match the pattern in the CROSS JOIN VALUES block for recruitment_options
const optionValues = [...sqlSrc.matchAll(
  /\('([a-z-]+)',\s*'([a-z-]+)',\s*\n\s*'([^']+)',\s*'([^']+)',\s*\n\s*'(required|none|optional|unconfirmed)'/g
)];

assert.equal(optionValues.length, 13, `SQL must define exactly 13 options (found ${optionValues.length})`);
console.log(`  OK: SQL defines 13 options`);

// Verify each SQL option matches the canonical catalog
for (const [, sqlMain, sqlSub, sqlMainLabel, sqlSubLabel, sqlState] of optionValues) {
  const match = canonical.find(c => c.mainCode === sqlMain && c.subCode === sqlSub);
  assert.ok(match, `SQL option (${sqlMain}, ${sqlSub}) must exist in draft-config.ts`);
  assert.equal(sqlMainLabel, match.mainLabel,
    `main_label mismatch for (${sqlMain}, ${sqlSub}): SQL="${sqlMainLabel}" vs TS="${match.mainLabel}"`);
  assert.equal(sqlSubLabel, match.subLabel,
    `sub_label mismatch for (${sqlMain}, ${sqlSub}): SQL="${sqlSubLabel}" vs TS="${match.subLabel}"`);

  const expectedState = sqlSub === "relations-partnership" ? "none" : "required";
  assert.equal(sqlState, expectedState,
    `assignment_state for ${sqlSub}: SQL="${sqlState}", expected="${expectedState}"`);
}
console.log(`  OK: All 13 SQL options match draft-config.ts codes, labels, and assignment states`);

// Verify every canonical entry is in SQL (reverse check)
for (const c of canonical) {
  const found = optionValues.find(([, m, s]) => m === c.mainCode && s === c.subCode);
  assert.ok(found, `Canonical (${c.mainCode}, ${c.subCode}) missing from SQL`);
}
console.log(`  OK: No canonical sub-divisions missing from SQL`);

// === 4. Verify document requirements in SQL ===

const configSrc = readFileSync(path.join(root, "src/modules/recruitment/config.ts"), "utf8");
const landingSrc = readFileSync(path.join(root, "src/modules/recruitment/landing.tsx"), "utf8");

// Expected from user instructions and config.ts documentSlots:
const expectedDocs = {
  cv:          ["pdf"],
  idCard:      ["pdf"],
  commitment:  ["pdf"],
  followProof: ["png"],
  storyProof:  ["png"],
};

// Verify config.ts documentSlots formats
const slotMatches = [...configSrc.matchAll(/\{\s*key:\s*"(\w+)"[^}]*format:\s*"(PDF|PNG)"/g)];
assert.equal(slotMatches.length, 5, "config.ts must define exactly 5 document slots");
for (const [, key, format] of slotMatches) {
  const expected = expectedDocs[key];
  assert.ok(expected, `Unexpected document slot: ${key}`);
  assert.equal(format.toLowerCase(), expected[0],
    `config.ts format for ${key}: "${format}" vs expected "${expected[0]}"`);
}
console.log(`  OK: config.ts documentSlots formats match expected (cv/idCard/commitment=PDF, followProof/storyProof=PNG)`);

// Verify SQL document requirements
const sqlDocValues = [...sqlSrc.matchAll(
  /\('(\w+)',\s*ARRAY\['([a-z]+(?:','[a-z]+)*)'\]\)/g
)];
assert.equal(sqlDocValues.length, 5, `SQL must define exactly 5 document requirements (found ${sqlDocValues.length})`);
for (const [, slot, formatsStr] of sqlDocValues) {
  const sqlFormats = formatsStr.split("','");
  const expected = expectedDocs[slot];
  assert.ok(expected, `Unexpected SQL document slot: ${slot}`);
  assert.deepEqual(sqlFormats, expected,
    `SQL formats for ${slot}: [${sqlFormats}] vs expected [${expected}]`);
}
console.log(`  OK: SQL document requirements match expected formats`);

// === 5. Verify landing.tsx SUPPORTING_DOCUMENTS consistency ===

// Verify format strings in landing.tsx
const landingDocs = [...landingSrc.matchAll(
  /\{\s*name:\s*"[^"]+",\s*format:\s*"(PDF|PNG)",\s*filename:\s*"[^"]+"\s*\}/g
)];
assert.equal(landingDocs.length, 5, `landing.tsx must define exactly 5 supporting documents`);
const landingFormats = landingDocs.map(m => m[1].toLowerCase());
assert.deepEqual(landingFormats, ["pdf", "pdf", "pdf", "png", "png"],
  `landing.tsx formats must be [pdf, pdf, pdf, png, png]`);
console.log(`  OK: landing.tsx SUPPORTING_DOCUMENTS formats are consistent`);

// === 6. Verify SQL structure ===

// Must be wrapped in BEGIN/COMMIT
assert.ok(sqlSrc.match(/^BEGIN;/m), "SQL must start with BEGIN");
assert.ok(sqlSrc.includes("COMMIT;"), "SQL must contain COMMIT");

// Approval/opening/migration/environment/deployment are separate artifacts/actions.
assert.ok(!/\bUPDATE\s+public\./i.test(sqlSrc), "Configuration SQL must not bundle updates/approval/opening");
assert.ok(!/\bDELETE\s+FROM\s+public\./i.test(sqlSrc));

// Must NOT contain relative date expressions in the active (uncommented) block
// Split at the first COMMIT to get only Part A
const partA = sqlSrc.split("COMMIT;")[0];
assert.ok(!partA.includes("now() + interval"), "Part A must not use relative dates like now() + interval");
assert.ok(!partA.includes("now() - interval"), "Part A must not use relative dates like now() - interval");

// Must use explicit timezone in timestamp literals
const timestampLiterals = [...partA.matchAll(/'(\d{4}-\d{2}-\d{2}T[^']+)'::timestamptz/g)];
for (const [, ts] of timestampLiterals) {
  assert.ok(/[+-]\d{2}:\d{2}$/.test(ts), `Timestamp ${ts} must include explicit timezone offset`);
}
console.log(`  OK: SQL uses explicit timestamps with timezone, no relative dates`);

// Part A must NOT approve or open
assert.ok(!partA.match(/\bapproval_reference\s*=\s*'[^']+'/),
  "Part A must not set approval_reference");
assert.ok(!partA.match(/\bis_open\s*=\s*true\b/),
  "Part A must not set is_open = true");
console.log(`  OK: Part A does not approve or open the period`);

// B9 final safety: these are source assertions only, NOT SQL execution.
const prepare = sqlSrc.match(/DO \$prepare\$([\s\S]*?)\$prepare\$;/)?.[1];
assert.ok(prepare, "All mutations must share one guarded preparation block");
const firstInsert = prepare.indexOf("INSERT INTO");
const approvedReturns = [...prepare.slice(0, firstInsert).matchAll(/IF v_period\.approved_at IS NOT NULL THEN[\s\S]*?RETURN;\s*END IF;/g)];
assert.equal(approvedReturns.length, 2, "Skip all inserts before and after draft row-lock race recheck");
assert.ok(prepare.indexOf("RETURN;") < prepare.indexOf("FOR UPDATE"), "Already-approved path must not acquire draft row lock");
assert.equal((prepare.match(/INSERT INTO public\./g) ?? []).length, 3);
assert.equal((sqlSrc.match(/INSERT INTO public\./g) ?? []).length, 3, "No mutations outside guarded block");
assert.deepEqual([...prepare.matchAll(/INSERT INTO public\.(\w+)/g)].map(m => m[1]),
  ["recruitment_periods", "recruitment_options", "recruitment_document_requirements"]);
assert.ok(!prepare.includes("b3c1-synthetic-test"), "Historical B7 must never be a mutation target");
assert.equal((prepare.match(/WHERE p\.id = v_period\.id AND p\.approved_at IS NULL AND NOT p\.is_open/g) ?? []).length, 2);
assert.ok(!/ON CONFLICT \(code\)/.test(prepare), "Do not attempt parent insert for existing approved period");
assert.ok(/VALUES \([\s\S]*?NULL,[^\n]*\n\s*NULL,[^\n]*\n\s*false,/.test(prepare), "New period must be draft and closed");
assert.ok(sqlSrc.includes("NOT p.is_open AND p.approval_reference IS NULL"), "Verify existing draft is closed");
assert.ok(sqlSrc.includes("period fields/schedule/draft-closed state mismatch"));
assert.ok(sqlSrc.includes("exact catalogue labels/instructions mismatch"));
for (const field of ["verified_project_ref","verified_api_origin","verified_organization_id","verified_pooler_host","verified_pooler_user"])
  assert.ok(sqlSrc.includes(`current_setting('spe_staging.${field}', true) IS DISTINCT FROM`), `Missing fail-closed target gate ${field}`);
assert.ok(sqlSrc.includes("operator attestations, NOT independently obtained identity evidence"));
assert.ok(sqlSrc.includes("DATE '2026-11-05'") && sqlSrc.includes("DATE '2026-11-12'"));
assert.ok(sqlSrc.includes("AT TIME ZONE 'Asia/Jakarta'"));
assert.ok(sqlSrc.includes("confirmed opening/closing timestamps with offset required; hours have no default"));
assert.ok(!/2026-11-(05|12)T/.test(sqlSrc), "Do not assume any official opening/closing hours");
assert.ok(!/\b(?:password|service_role_key)\s*=|postgres(?:ql)?:\/\//i.test(sqlSrc), "No credentials/connection strings in reviewed SQL");
const schema = readFileSync(path.join(root,"supabase/migrations/20261101000000_recruitment_schema.sql"),"utf8");
assert.ok(/recruitment_options_guard before insert/i.test(schema) && /recruitment_requirements_guard before insert/i.test(schema));
assert.ok(schema.includes("if approved is not null then raise exception 'approved_configuration_immutable'"));
console.log("  OK: approved-period INSERT bypass, draft/closed gate, exact configuration checks, B7 mutation exclusion, explicit target evidence and unassumed hours");

// === 7. Cross-check landing.tsx CONFIRMED_DIVISIONS vs draft-config.ts ===

const landingDivs = [...landingSrc.matchAll(
  /id:\s*"([^"]+)",\s*\n\s*name:\s*"([^"]+)",\s*\n\s*subDivisions:\s*\[([^\]]+)\]/g
)];
assert.equal(landingDivs.length, 6, "landing.tsx must list exactly 6 CONFIRMED_DIVISIONS");
const landingIds = landingDivs.map(m => m[1]).sort();
const draftIds = [...new Set(canonical.map(c => c.mainCode))].sort();
assert.deepEqual(landingIds, draftIds,
  "landing.tsx division IDs must match draft-config.ts division IDs");
console.log(`  OK: landing.tsx CONFIRMED_DIVISIONS IDs match draft-config.ts`);

console.log(`\n✓ All catalog consistency assertions passed.`);
