"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { ApplicationEntry, inputStyle, MockNotice, primaryButton, RecruitmentFrame, secondaryButton } from "./components";
import { documentSlots, MAX_FILE_BYTES, recruitmentCatalogs, recruitmentConfig, type RecruitmentCatalog } from "./config";
import { resolvePreference, validateAssignment } from "./assignment";
import { Field, FileField } from "./form-fields";
import { PreferenceStep } from "./preference-step";
import { assignmentPresentation, clientMessage, documentLabel, preferenceLabel, PREVIEW_NOTICE, previewText, steps } from "./presentation";
import { preferenceFields, type PreferenceRank, type RecruitmentPeriod } from "./recruitment-types";
import { emptyValues, validateFile, validateStep, validateSubmission, type ApplicationFiles, type ApplicationValues, type DocumentKey, type Errors } from "./validation";

const personalFields = [
  { key: "fullName", label: "Full name", type: "text", placeholder: "Name as shown on your ID" },
  { key: "nim", label: "Student ID (NIM)", type: "text", placeholder: "Student identification number" },
  { key: "birthPlace", label: "Place of birth", type: "text", placeholder: "City / regency" },
  { key: "birthDate", label: "Date of birth", type: "date", placeholder: "" },
  { key: "ugmEmail", label: "UGM email", type: "email", placeholder: "University email address" },
  { key: "phoneNumber", label: "Phone number", type: "tel", placeholder: "A number we can reach you on" },
  { key: "major", label: "Study program", type: "text", placeholder: "Study program" },
] as const;

export function ApplicationWizard({ backend = false }: { backend?: boolean }) {
  const [livePeriod, setLivePeriod] = useState<RecruitmentPeriod>();
  const session = useRef("");
  const [sending, setSending] = useState(false);
  const [serverError, setServerError] = useState("");
  const [receipt, setReceipt] = useState("");
  useEffect(() => {
    if (!backend) return;
    let active = true;
    fetch("/api/recruitment", { cache: "no-store", credentials: "same-origin" })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); return data; })
      .then(data => { if (active) { session.current = data.token; setLivePeriod(data.period); } })
      .catch(error => { if (active) setServerError(error instanceof Error ? error.message : "Applications are currently unavailable."); });
    return () => { active = false; };
  }, [backend]);
  const [catalog, setCatalog] = useState<RecruitmentCatalog>("draft");
  const period = livePeriod ?? recruitmentCatalogs[catalog];
  const [selectionNotice, setSelectionNotice] = useState("");
  const [values, setValues] = useState<ApplicationValues>({ ...emptyValues });
  const [files, setFiles] = useState<ApplicationFiles>({});
  const [errors, setErrors] = useState<Errors>({});
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<"editing" | "review" | "success">("editing");
  const heading = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    heading.current?.focus();
  }, [step, phase]);

  function change(key: keyof ApplicationValues, value: string) {
    setValues((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => ({ ...previous, [key]: undefined }));
  }

  function clearAssignment(key: "assignment1" | "assignment2") {
    setFiles((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
  }

  function changePreference(rank: PreferenceRank, level: "division" | "subDivision", value: string) {
    const fields = preferenceFields[rank];
    const field = fields[level];
    if (values[field] === value) return;
    setValues((previous) => ({ ...previous, [field]: value, ...(level === "division" ? { [fields.subDivision]: "" } : {}) }));
    clearAssignment(fields.assignment);
    setErrors((previous) => ({ ...previous, subDivision1: undefined, subDivision2: undefined, [fields.division]: undefined, [fields.assignment]: undefined }));
    setSelectionNotice(`Your ${preferenceLabel(rank)} preference was updated. Its assignment file was cleared${level === "division" ? "; choose a sub-division again" : ""}.`);
  }

  function changeCatalog(next: RecruitmentCatalog) {
    if (next === catalog) return;
    setCatalog(next);
    setValues((previous) => ({ ...previous, division1: "", subDivision1: "", division2: "", subDivision2: "" }));
    clearAssignment("assignment1");
    clearAssignment("assignment2");
    setErrors({});
    setStep(0);
    setPhase("editing");
    setSelectionNotice("Preview configuration changed. Both preferences and their assignment files were cleared. Personal information and supporting documents were retained.");
  }

  function changeFile(key: DocumentKey, file?: File) {
    setFiles((previous) => {
      const next = { ...previous };
      if (file) next[key] = file;
      else delete next[key];
      return next;
    });
    let error: string | undefined;
    if (key === "assignment1" || key === "assignment2") {
      const fields = preferenceFields[key === "assignment1" ? 1 : 2];
      const { subDivision } = resolvePreference(period, values[fields.division], values[fields.subDivision]);
      error = file ? validateAssignment(subDivision?.assignment, file, false) : undefined;
    } else error = file ? validateFile(key, file) : undefined;
    setErrors((previous) => ({ ...previous, [key]: error ? clientMessage(error, !backend) : error }));
  }

  function check(target: number, forSubmission = false): boolean {
    const nextErrors = validateStep(target, values, files, period, forSubmission);
    setErrors(Object.fromEntries(Object.entries(nextErrors).map(([key, message]) => [key, message ? clientMessage(message, !backend) : message])));
    const firstKey = Object.keys(nextErrors)[0];
    if (!firstKey) return true;
    setPhase("editing");
    setStep(target);
    requestAnimationFrame(() => document.getElementById(`recruit-${firstKey}`)?.focus());
    return false;
  }

  function next() {
    if (!check(step)) return;
    if (step < 3) setStep(step + 1);
    else {
      for (let index = 0; index < 4; index++) if (!check(index)) return;
      setPhase("review");
    }
  }

  function edit(target: number) { setStep(target); setPhase("editing"); setErrors({}); }

  function simulateSubmission() {
  if (recruitmentConfig.status !== "open") return;
    for (let index = 0; index < 4; index++) if (!check(index, true)) return;
    // Deliberately synchronous, memory-only UI transition. No submission adapter,
    // server action, fetch, analytics event, or persistent storage is involved.
    setValues({ ...emptyValues });
    setFiles({});
    setErrors({});
    setSelectionNotice("");
    setPhase("success");
  }

  async function submitApplication() {
    if (sending || !livePeriod) return;
    for (let index = 0; index < 4; index++) if (!check(index, true)) return;
    setSending(true); setServerError("");
    try {
      const body = new FormData();
      for (const [key, value] of Object.entries(values)) body.append(key, value);
      for (const [key, file] of Object.entries(files)) if (file) body.append(key, file);
      const response = await fetch("/api/recruitment", { method: "POST", credentials: "same-origin", headers: { "x-recruitment-session": session.current }, body });
      const data = await response.json();
      if (!response.ok) { setErrors(data.fields ?? {}); throw new Error(data.error); }
      setReceipt(data.applicationId); setValues({ ...emptyValues }); setFiles({}); setErrors({}); setPhase("success");
    } catch (error) { setServerError(error instanceof Error ? error.message : "Submission has not been confirmed. Retry with the same information and files."); }
    finally { setSending(false); }
  }

  function handleEnter(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement && ["text", "email", "tel"].includes(event.target.type)) {
      event.preventDefault();
      next();
    }
  }

  if (backend && !livePeriod) return <RecruitmentFrame><section className="mx-auto max-w-xl py-16"><h1 className="font-display text-3xl font-semibold">SPE UGM SC application</h1><p role="status" className="mt-6">{serverError || "Loading the recruitment period…"}</p><Link href="/join" className={`${secondaryButton} mt-6`}>Back</Link></section></RecruitmentFrame>;
  if (backend && phase === "success") return <RecruitmentFrame><section className="mx-auto max-w-2xl py-16 text-center"><h1 className="font-display text-3xl font-semibold">Application submitted.</h1><p className="mt-6">Confirmation number: <strong>{receipt}</strong></p><p className="mt-4">Save this number. Contact the committee for corrections after submission; do not submit another application.</p><Link href="/join" className={`${secondaryButton} mt-6`}>Back</Link></section></RecruitmentFrame>;

  if (recruitmentConfig.status !== "open") return <RecruitmentFrame>{!backend && <MockNotice />}<section className="mx-auto max-w-xl py-16"><h1 className="font-display text-3xl font-semibold">Application preview unavailable</h1><div className="mt-6"><ApplicationEntry /></div><Link href="/join" className={`${secondaryButton} mt-6`}>Back to recruitment information</Link></section></RecruitmentFrame>;

  if (phase === "success") return <RecruitmentFrame>{!backend && <MockNotice />}<section className="mx-auto max-w-2xl py-16 text-center">
    <span aria-hidden="true" className="mx-auto grid size-16 place-items-center rounded-full bg-[#ebe6ff] text-3xl text-iris">✓</span>
    <p className="mt-6 text-xs font-semibold tracking-[0.15em] text-iris uppercase">Preview complete</p>
    <h1 ref={heading} tabIndex={-1} className="mt-4 scroll-mt-32 font-display text-3xl font-semibold tracking-tight outline-none sm:text-4xl">Preview completed.</h1>
    <p className="mt-5 text-lg font-semibold text-ink-deep">No real application was submitted.</p>
    <p className="mt-3 text-base leading-7 text-ink-soft">{PREVIEW_NOTICE} Your entries and selected files have been cleared. This preview does not issue a confirmation number or an acceptance receipt.</p>
    <div className="mt-8 flex flex-wrap justify-center gap-3"><Link href="/join" className={secondaryButton}>Back to recruitment</Link><button type="button" className={primaryButton} onClick={() => { setStep(0); setPhase("editing"); }}>Restart preview</button></div>
  </section></RecruitmentFrame>;

  const errorCount = Object.values(errors).filter(Boolean).length;
  const submissionErrors = validateSubmission(values, files, period);
  return <RecruitmentFrame>
    <Link href="/join" className="mb-6 inline-flex min-h-10 items-center gap-2 rounded-lg text-sm font-medium text-ink-soft hover:text-iris focus-visible:outline-2 focus-visible:outline-iris"><span aria-hidden="true">←</span> Recruitment information</Link>
    {!backend && <MockNotice />}
    {!backend && <div className="mt-6 max-w-3xl">
      <label htmlFor="recruit-catalog" className="mb-2 block text-sm font-semibold text-ink-deep">Preview configuration</label>
      <select id="recruit-catalog" value={catalog} onChange={(event) => changeCatalog(event.target.value as RecruitmentCatalog)} aria-describedby="catalog-notice" className={inputStyle}>
        <option value="draft">Draft — unconfirmed requirements</option>
        <option value="demo">Synthetic demo — preview only</option>
      </select>
      <p id="catalog-notice" className="mt-2 text-sm leading-6 text-ink-soft">{previewText(period.notice)}</p>
      <p role="status" aria-live="polite" className="mt-2 text-sm leading-6 text-ink-soft">{selectionNotice}</p>
    </div>
    }
    {backend && <p role="status" aria-live="polite" className="mt-2 text-sm text-ink-soft">{selectionNotice}</p>}
    {serverError && <p role="alert" className="mt-6 rounded-xl bg-red-50 p-4 text-red-800">{serverError}</p>}
    <div className="grid gap-6 pt-8 lg:grid-cols-[250px_1fr] lg:gap-12">
      <aside aria-label="Application progress" className="self-start lg:sticky lg:top-28">
        <p className="text-xs font-semibold tracking-[0.15em] text-iris uppercase">SPE UGM SC · {period.label}</p>
        <h2 className="mt-3 font-display text-2xl font-semibold tracking-tight">Application<br className="hidden lg:block" /> {backend ? "form." : "preview."}</h2>
        <ol className="mt-4 grid grid-cols-4 gap-2 lg:mt-6 lg:grid-cols-1 lg:gap-3">{steps.map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined} className={`flex items-center justify-center gap-3 rounded-xl px-2 py-3 text-[15px] lg:justify-start lg:px-3 ${step === index ? "bg-[#eeebff] font-semibold text-[#5947b5] ring-1 ring-[#c9bff0]" : "text-ink-soft"}`}><span aria-hidden="true" className={`grid size-8 shrink-0 place-items-center rounded-full ${step >= index ? "bg-iris text-white" : "border border-[#dcddea] bg-white"}`}>{step > index ? "✓" : index + 1}</span><span className="sr-only lg:not-sr-only">{label}{step > index && <span className="sr-only"> — completed</span>}</span></li>)}</ol>
        <p className="mt-5 hidden text-sm leading-relaxed text-ink-soft lg:block">Choose two different sub-divisions, including within the same main division. Back keeps your entries and files; reloading clears them.</p>
        <p className="mt-3 hidden text-sm text-ink-soft lg:block">Official guidebook publication pending.</p>
      </aside>
      <section className="min-w-0 rounded-3xl border border-[#e4e5ef] bg-white p-5 sm:p-8">
        <p className="text-xs font-semibold tracking-[0.12em] text-iris uppercase">Step {step + 1} of 4{phase === "review" ? " · Review" : ""}</p>
        <h1 ref={heading} tabIndex={-1} id="wizard-title" className="mt-3 scroll-mt-32 font-display text-2xl font-semibold tracking-tight outline-none sm:text-3xl">{phase === "review" ? (backend ? "Review your application" : "Review your preview") : steps[step]}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">{phase === "review" ? (backend ? "Check your information carefully. Submitted applications cannot be edited directly." : "Check your entries. Completing this preview will not submit an application.") : step === 0 ? (backend ? "Enter your personal information as shown on your documents." : "Use sample information to explore the application process.") : step === 3 ? (backend ? "Attach the five supporting documents using the requirements shown below." : "Choose five sample documents, then review your preview.") : (backend ? "Assignment requirements depend on your selected sub-division." : "Explore your preference and its assignment requirements. Preview rules are not official.")}</p>
        {errorCount > 0 && <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">Please check {errorCount} highlighted fields and the messages below.</div>}
        {phase === "review" ? <fieldset disabled={sending} className="mt-8 space-y-7">
          <SummaryGroup title="Personal information" onEdit={() => edit(0)}><dl className="grid gap-4 sm:grid-cols-2">{[...personalFields.map((field) => [field.label, values[field.key]]), ["Cohort", values.batch]].map(([label, value]) => <SummaryValue key={label} label={label} value={value} />)}</dl></SummaryGroup>
          <p className="text-sm leading-6 text-ink-soft">Configuration: {period.contentState === "approved" ? "approved committee configuration" : period.contentState === "demo" ? "synthetic examples" : "draft catalogue, not yet approved"}.</p>
          {([1, 2] as const).map((rank) => {
            const fields = preferenceFields[rank];
            const { division, subDivision } = resolvePreference(period, values[fields.division], values[fields.subDivision]);
            const assignment = assignmentPresentation(subDivision?.assignment, files[fields.assignment], !backend);
            return <SummaryGroup key={rank} title={`${rank === 1 ? "First" : "Second"} preference`} onEdit={() => edit(rank)}><dl className="space-y-4"><SummaryValue label="Main division" value={(!backend ? previewText(division?.label) : division?.label) ?? "—"} /><SummaryValue label="Sub-division" value={(!backend ? previewText(subDivision?.label) : subDivision?.label) ?? "—"} /><SummaryValue label="Motivation" value={values[fields.motivation]} /><SummaryValue label="Assignment" value={assignment.summary} /></dl></SummaryGroup>;
          })}
          <SummaryGroup title="Supporting documents" onEdit={() => edit(3)}><dl className="space-y-4">{documentSlots.map((slot) => <SummaryValue key={slot.key} label={`${documentLabel(slot.key)} (${slot.format})`} value={`${files[slot.key]?.name ?? "—"} · ${((files[slot.key]?.size ?? 0) / 1024).toFixed(1)} KiB`} />)}</dl></SummaryGroup>
          <div className="rounded-2xl bg-[#f2efff] p-5 text-sm leading-6 text-[#4a398c]"><p className="font-semibold">{backend ? "Your information and documents are sent privately to the committee." : PREVIEW_NOTICE}</p><p className="mt-1">{backend ? "If your connection fails, retry with the same information and files without reloading. Contact the committee for corrections after submission." : "Completing this preview stays in this browser. Your information and files are not saved or submitted."}</p></div>
          {Object.keys(submissionErrors).length > 0 && <div id="submission-blockers" role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950"><p className="font-semibold">{backend ? "Submission unavailable" : "Preview completion blocked"}</p><ul className="mt-2 list-disc space-y-1 pl-5">{Object.entries(submissionErrors).map(([field, message]) => <li key={field}>{field === "subDivision1" ? "First preference: " : field === "subDivision2" ? "Second preference: " : ""}{message ? clientMessage(message, !backend) : message}</li>)}</ul><p className="mt-2">{backend ? "Check your entries or contact the committee." : "Edit the affected preference or wait for confirmed requirements. Synthetic examples let you test each assignment state."}</p></div>}
          <div className="flex flex-col-reverse justify-between gap-3 border-t border-[#e7e8f0] pt-6 sm:flex-row"><button type="button" className={secondaryButton} onClick={() => edit(3)}>Back</button><button type="button" className={primaryButton} onClick={backend ? submitApplication : simulateSubmission} disabled={sending || Object.keys(submissionErrors).length > 0} aria-describedby={Object.keys(submissionErrors).length > 0 ? "submission-blockers" : undefined}>{backend ? sending ? "Submitting…" : "Submit application" : "Complete preview"} <span aria-hidden="true">✓</span></button></div>
        </fieldset> : <div role="form" aria-labelledby="wizard-title" onKeyDown={handleEnter} className="mt-8">
          {/* No HTML form or named controls: there is no native network-submit path,
              including before hydration or when JavaScript is unavailable. */}
          <noscript><p className="mb-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Enable JavaScript to use this preview. This page cannot submit an application without it.</p></noscript>
          <fieldset><legend className="sr-only">{steps[step]}</legend>
            {step === 0 && <div className="grid gap-6 sm:grid-cols-2">{personalFields.map((field) => {
              const id = `recruit-${field.key}`;
              const hint = field.key === "ugmEmail" ? backend ? "Use an active email address. Contact the committee for corrections after submission." : "Use a sample email address for this preview." : field.key === "nim" ? "Enter your student ID as text, including any leading zeros." : undefined;
              return <Field key={field.key} id={id} label={field.label} error={errors[field.key]} hint={hint}><input id={id} type={field.type} value={values[field.key]} onChange={(event) => change(field.key, event.target.value)} placeholder={field.placeholder} autoComplete="off" maxLength={field.key === "ugmEmail" ? 254 : field.key === "phoneNumber" ? 25 : 150} required aria-invalid={Boolean(errors[field.key])} aria-describedby={[hint ? `${id}-hint` : "", errors[field.key] ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined} className={inputStyle} /></Field>;
            })}<Field id="recruit-batch" label="Cohort" error={errors.batch}><select id="recruit-batch" value={values.batch} onChange={(event) => change("batch", event.target.value)} required aria-invalid={Boolean(errors.batch)} aria-describedby={errors.batch ? "recruit-batch-error" : undefined} className={inputStyle}><option value="">Choose your cohort</option>{period.batches.map((batch) => <option key={batch} value={batch}>{batch}</option>)}</select></Field></div>}
            {(step === 1 || step === 2) && <PreferenceStep rank={step} preview={!backend} period={period} values={values} files={files} errors={errors} onDivision={(value) => changePreference(step, "division", value)} onSubDivision={(value) => changePreference(step, "subDivision", value)} onMotivation={(value) => change(preferenceFields[step].motivation, value)} onFile={(file) => changeFile(preferenceFields[step].assignment, file)} />}
            {step === 3 && <div className="space-y-6">{documentSlots.map((slot) => <FileField key={slot.key} slot={{ ...slot, label: documentLabel(slot.key) }} required={period.documents?.[slot.key]?.required ?? true} upload={period.documents?.[slot.key] ?? { formats: [slot.format === "PDF" ? "pdf" : "png"], maxBytes: MAX_FILE_BYTES, filename: slot.filename }} file={files[slot.key]} error={errors[slot.key]} onChange={(file) => changeFile(slot.key, file)} />)}</div>}
          </fieldset>
          <div className="mt-8 flex flex-col-reverse justify-between gap-3 border-t border-[#e7e8f0] pt-6 sm:flex-row">{step > 0 ? <button type="button" className={secondaryButton} onClick={() => edit(step - 1)}>Back</button> : <Link href="/join" className={secondaryButton}>Back</Link>}<button type="button" className={primaryButton} onClick={next}>{step === 3 ? "Review application" : "Next"}<span aria-hidden="true">→</span></button></div>
          <p className="mt-4 text-center text-sm text-ink-soft">{backend ? "Documents are stored privately for the committee." : PREVIEW_NOTICE}</p>
        </div>}
      </section>
    </div>
  </RecruitmentFrame>;
}

function SummaryValue({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-sm font-medium text-ink-soft">{label}</dt><dd className="mt-1 text-[15px] leading-relaxed whitespace-pre-wrap break-words text-ink-deep">{value}</dd></div>;
}

function SummaryGroup({ title, onEdit, children }: { title: string; onEdit: () => void; children: ReactNode }) {
  return <section className="border-b border-[#e4e5ef] pb-6"><div className="mb-4 flex items-center justify-between gap-3"><h2 className="font-display text-lg font-semibold">{title}</h2><button type="button" onClick={onEdit} aria-label={`Edit ${title}`} className="min-h-10 rounded-lg px-2 text-sm font-semibold text-iris hover:bg-[#f2efff] focus-visible:outline-2 focus-visible:outline-iris">Edit</button></div>{children}</section>;
}
