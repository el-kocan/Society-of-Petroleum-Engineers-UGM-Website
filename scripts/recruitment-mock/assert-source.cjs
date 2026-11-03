/* eslint-disable @typescript-eslint/no-require-imports -- Isolated CommonJS compilation harness. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

assert(globalThis[Symbol.for("spe.recruitment.networkGuard")]);
// Compile only the frontend modules in this credential-free copy for focused
// validation and state-gate checks. No application server is started here.
for (const extension of [".ts", ".tsx"]) {
  require.extensions[extension] = (module, filename) => {
    const source = fs.readFileSync(filename, "utf8");
    module._compile(ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2020 },
    }).outputText, filename);
  };
}
const root = path.join(process.cwd(), "src/modules/recruitment");
const { documentSlots, MAX_FILE_BYTES, recruitmentConfig, recruitmentCatalogs, approvedRecruitmentPeriods } = require(path.join(root, "config.ts"));
const { emptyValues, validateFile, validateStep, validateSubmission } = require(path.join(root, "validation.ts"));
const { assignmentView, resolvePreference, validateAssignment } = require(path.join(root, "assignment.ts"));
const { preferenceFields } = require(path.join(root, "recruitment-types.ts"));
const demo = recruitmentCatalogs.demo;
const draft = recruitmentCatalogs.draft;
const values = {
  ...emptyValues, fullName: "Synthetic Applicant", nim: "SYNTHETIC-001",
  birthPlace: "Kota Contoh", birthDate: "2007-01-02", ugmEmail: "synthetic@example.invalid",
  phoneNumber: "+620000000001", major: "Program Studi Contoh", batch: "2026",
  division1: "example-a", subDivision1: "a-required", division2: "example-b", subDivision2: "b-required", motivation1: "Contoh alasan satu", motivation2: "Contoh alasan dua",
};
const files = Object.fromEntries(documentSlots.map((slot) => [slot.key, new File(["synthetic"], slot.format === "PDF" ? "sample.pdf" : "sample.png", { type: slot.format === "PDF" ? "application/pdf" : "image/png" })]));
const pdf = new File(["synthetic"], "sample.pdf", { type: "application/pdf" });
files.assignment1 = pdf;
for (let step = 0; step < 4; step++) assert.deepEqual(validateStep(step, values, files, demo), {});
assert.deepEqual(validateSubmission(values, files, demo), {});
const duplicatePreference = { ...values, division2: values.division1, subDivision2: values.subDivision1 };
assert(validateStep(1, duplicatePreference, files, demo).subDivision1);
assert(validateStep(2, duplicatePreference, files, demo).subDivision2);
assert(validateSubmission(duplicatePreference, files, demo).subDivision2);
assert.deepEqual(validateSubmission({ ...values, division2: 'example-a', subDivision2: 'a-optional' }, files, demo), {});
assert.equal(Object.keys(validateStep(0, emptyValues, {})).length, 8);
assert(validateStep(0, { ...values, birthDate: "2025-02-29" }, files).birthDate);
assert(validateStep(0, { ...values, birthDate: "2099-01-01" }, files).birthDate);
assert(validateStep(0, { ...values, ugmEmail: "invalid" }, files).ugmEmail);
assert(validateStep(0, { ...values, phoneNumber: "--------" }, files).phoneNumber);
assert(validateStep(0, { ...values, batch: "2024" }, files).batch);
assert(validateStep(0, { ...values, fullName: " ".repeat(5) }, files).fullName);
assert(validateStep(0, { ...values, major: "x".repeat(151) }, files).major);
assert(validateStep(1, { ...values, division1: "unconfigured" }, files, demo).division1);
assert(validateStep(2, { ...values, motivation2: "x".repeat(3001) }, files, demo).motivation2);
assert.equal(Object.keys(validateStep(3, values, {})).length, 5);
assert(validateFile("cv", new File([], "empty.pdf", { type: "application/pdf" })));
assert(validateFile("cv", new File(["x"], "fake.pdf", { type: "text/plain" })));
assert(validateFile("cv", new File(["x"], "fake.png", { type: "application/pdf" })));
assert(validateFile("followProof", files.cv));
assert.equal(validateFile("cv", new File([new Uint8Array(MAX_FILE_BYTES)], "boundary.PDF", { type: "application/pdf" })), undefined);
assert(validateFile("cv", new File([new Uint8Array(MAX_FILE_BYTES + 1)], "large.pdf", { type: "application/pdf" })));

assert.equal(draft.contentState, "draft");
assert.equal(demo.contentState, "demo");
assert.equal(Object.keys(approvedRecruitmentPeriods).length, 0);
assert.equal(draft.divisions.length, 6);
assert.equal(draft.divisions.flatMap((item) => item.subDivisions).length, 13);
const relPart = draft.divisions.find((d) => d.id === "external-affairs").subDivisions.find((s) => s.id === "relations-partnership");
assert.equal(relPart.assignment.status, "none");
const webDev = draft.divisions.find((d) => d.id === "media-creative").subDivisions.find((s) => s.id === "website-development");
assert.equal(webDev.assignment.status, "required");
const otherSubs = draft.divisions.flatMap((d) => d.subDivisions).filter((s) => s.id !== "relations-partnership");
assert(otherSubs.every((s) => s.assignment.status === "required"));

for (const rank of [1, 2]) {
  const fields = preferenceFields[rank];
  const divisionId = rank === 1 ? "example-a" : "example-b";
  const prefix = rank === 1 ? "a" : "b";
  for (const status of ["required", "optional", "none", "unconfirmed"]) {
    const selected = { ...values, [fields.division]: divisionId, [fields.subDivision]: `${prefix}-${status}` };
    const withoutFile = { ...files };
    delete withoutFile[fields.assignment];
    const { subDivision } = resolvePreference(demo, divisionId, selected[fields.subDivision]);
    const view = assignmentView(subDivision.assignment);
    assert.equal(Boolean(view.upload), status === "required" || status === "optional");
    assert.equal(view.required, status === "required");
    const stepErrors = validateStep(rank, selected, withoutFile, demo);
    if (rank === 1) {
      assert.equal(Boolean(stepErrors[fields.assignment]), status === "required");
      const finalErrors = validateSubmission(selected, withoutFile, demo);
      assert.equal(Boolean(finalErrors[fields.subDivision]), status === "unconfirmed");
      assert.equal(Boolean(finalErrors[fields.assignment]), status === "required");
      if (status === "optional") {
        assert(validateStep(rank, selected, { ...files, [fields.assignment]: new File(["x"], "wrong.png", { type: "image/png" }) }, demo)[fields.assignment]);
        assert.deepEqual(validateSubmission(selected, withoutFile, demo), {});
      }
    } else {
      // Rank 2 never requires or validates an assignment
      assert.equal(stepErrors[fields.assignment], undefined);
    }
    if (status === "none") assert(view.summary.includes("tidak diperlukan"));
  }
  assert(validateStep(rank, { ...values, [fields.subDivision]: `${rank === 1 ? "b" : "a"}-required` }, files, demo)[fields.subDivision], "Cross-parent sub-division must fail");
}
const draftValues = { ...values, division1: "internal-affairs", subDivision1: "human-capital", division2: "finance", subDivision2: "sponsorship" };
assert.deepEqual(validateStep(1, draftValues, files, draft), {});
assert.deepEqual(validateStep(2, draftValues, files, draft), {});
assert.deepEqual(validateSubmission(draftValues, files, draft), {});

const draftWithoutA1 = { ...files };
delete draftWithoutA1.assignment1;
assert(validateStep(1, draftValues, draftWithoutA1, draft).assignment1);
assert(validateSubmission(draftValues, draftWithoutA1, draft).assignment1);

const draftRelValues = { ...values, division1: "external-affairs", subDivision1: "relations-partnership", division2: "internal-affairs", subDivision2: "human-capital" };
assert.deepEqual(validateStep(1, draftRelValues, draftWithoutA1, draft), {});
assert.deepEqual(validateSubmission(draftRelValues, draftWithoutA1, draft), {});

const draftWebValues = { ...values, division1: "media-creative", subDivision1: "website-development", division2: "external-affairs", subDivision2: "relations-partnership" };
assert(validateStep(1, draftWebValues, draftWithoutA1, draft).assignment1);
assert.deepEqual(validateStep(1, draftWebValues, files, draft), {});

assert(validateAssignment(undefined, undefined, true));

// Format support is driven by the rule, never enabled as an official policy.
const powerpointRule = { status: "optional", instructions: "Synthetic format test", upload: { formats: ["pdf", "ppt", "pptx"], maxBytes: MAX_FILE_BYTES, filename: "Name_Assignment_SubDivision.pptx" } };
assert.equal(validateAssignment(powerpointRule, new File(["x"], "example.pptx", { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" }), true), undefined);
assert(validateAssignment(powerpointRule, new File(["x"], "example.pptx", { type: "text/plain" }), true));
const future = { ...demo, id: "2027-2028-demo", label: "2027/2028", batches: ["2027"] };
assert(validateStep(0, values, files, future).batch);
assert.deepEqual(validateSubmission({ ...values, batch: "2027" }, files, future), {});

const { renderToStaticMarkup } = require("react-dom/server");
const { RecruitmentLanding } = require(path.join(root, "landing.tsx"));
const { ApplicationWizard } = require(path.join(root, "wizard.tsx"));
for (const status of ["closed", "pending"]) {
  recruitmentConfig.status = status;
  assert(!renderToStaticMarkup(RecruitmentLanding()).includes('href="/join/apply"'));
  const React = require("react");
  assert(renderToStaticMarkup(React.createElement(ApplicationWizard)).includes("Application preview unavailable"));
}
recruitmentConfig.status = "open";
assert(renderToStaticMarkup(RecruitmentLanding()).includes('href="/join/apply"'));
for (const name of fs.readdirSync(root)) {
  if (!/\.tsx?$/.test(name)) continue;
  const source = fs.readFileSync(path.join(root, name), "utf8");
  if (name === "wizard.tsx") {
    assert(source.includes("if (!backend) return;"), "Mock mode must not load remote configuration");
    assert(source.includes("backend ? submitApplication : simulateSubmission"), "Mock submission must stay local");
    assert.deepEqual([...source.matchAll(/fetch\("([^"]+)"/g)].map(match => match[1]), ["/api/recruitment", "/api/recruitment"]);
  } else assert(!/\b(?:fetch|XMLHttpRequest|WebSocket|sendBeacon)\s*\(/.test(source), `Network call in ${name}`);
  assert(!/\b(?:localStorage|sessionStorage|indexedDB)\b|document\.cookie|["']use server["']|@supabase|lib\/supabase/.test(source), `Persistence/backend import in ${name}`);
}
console.log("PASS: distinct ranked preferences including same-parent choices, four assignment states, parent-child validation, draft/approved separation, file boundaries and isolated mock mode");
