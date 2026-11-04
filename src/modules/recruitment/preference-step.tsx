"use client";

import { resolvePreference } from "./assignment";
import { inputStyle } from "./components";
import { Field, FileField } from "./form-fields";
import { preferenceFields, type PreferenceRank, type RecruitmentPeriod } from "./recruitment-types";
import { assignmentPresentation, previewText } from "./presentation";
import { OFFICIAL_GUIDEBOOK_URL } from "./public-information";
import type { ApplicationFiles, ApplicationValues, Errors } from "./validation";

export function PreferenceStep({ rank, preview = false, period, values, files, errors, onDivision, onSubDivision, onMotivation, onFile }: {
  rank: PreferenceRank;
  preview?: boolean;
  period: RecruitmentPeriod;
  values: ApplicationValues;
  files: ApplicationFiles;
  errors: Errors;
  onDivision: (value: string) => void;
  onSubDivision: (value: string) => void;
  onMotivation: (value: string) => void;
  onFile: (file?: File) => void;
}) {
  const fields = preferenceFields[rank];
  const { division, subDivision } = resolvePreference(period, values[fields.division], values[fields.subDivision]);
  const assignment = assignmentPresentation(subDivision?.assignment, files[fields.assignment], preview);
  const divisionId = `recruit-${fields.division}`;
  const subDivisionId = `recruit-${fields.subDivision}`;
  const motivationId = `recruit-${fields.motivation}`;

  return (
    <div className="space-y-7">
      <Field id={divisionId} label="Main division" error={errors[fields.division]} hint="Changing the main division clears its sub-division and assignment file.">
        <select id={divisionId} value={values[fields.division]} onChange={(event) => onDivision(event.target.value)} required aria-invalid={Boolean(errors[fields.division])} aria-describedby={`${divisionId}-hint${errors[fields.division] ? ` ${divisionId}-error` : ""}`} className={inputStyle}>
          <option value="">Choose a main division</option>
          {period.divisions.map((item) => <option key={item.id} value={item.id}>{preview ? previewText(item.label) : item.label}</option>)}
        </select>
      </Field>
      <Field id={subDivisionId} label="Sub-division" error={errors[fields.subDivision]} hint="Choose two different sub-divisions; they may belong to the same main division.">
        <select id={subDivisionId} value={values[fields.subDivision]} onChange={(event) => onSubDivision(event.target.value)} disabled={!division} required aria-invalid={Boolean(errors[fields.subDivision])} aria-describedby={`${subDivisionId}-hint${errors[fields.subDivision] ? ` ${subDivisionId}-error` : ""}`} className={`${inputStyle} disabled:cursor-not-allowed disabled:bg-ground`}>
          <option value="">{division ? "Choose a sub-division" : "Choose a main division first"}</option>
          {division?.subDivisions.map((item) => <option key={item.id} value={item.id}>{preview ? previewText(item.label) : item.label}</option>)}
        </select>
      </Field>
      <Field id={motivationId} label="Why this sub-division?" error={errors[fields.motivation]} hint={`${values[fields.motivation].length.toLocaleString("en-US")} / 3,000 characters.`}>
        <textarea id={motivationId} value={values[fields.motivation]} onChange={(event) => onMotivation(event.target.value)} required maxLength={3000} rows={5} placeholder="Explain why this sub-division interests you." aria-invalid={Boolean(errors[fields.motivation])} aria-describedby={`${motivationId}-hint${errors[fields.motivation] ? ` ${motivationId}-error` : ""}`} className={`${inputStyle} resize-y`} />
      </Field>
      {rank === 1 ? (
        <>
          <div role="status" aria-live="polite" className="rounded-2xl bg-[#f0eefb] p-4 sm:p-5 text-[15px] leading-relaxed">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-semibold text-ink-deep">Assignment · First preference: {assignment.label}</p>
              {OFFICIAL_GUIDEBOOK_URL ? (
                <a
                  href={OFFICIAL_GUIDEBOOK_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#5947b5] hover:text-[#43358b] hover:underline focus-visible:outline-2 focus-visible:outline-iris"
                >
                  View Guidebook <span aria-hidden="true">↗</span>
                </a>
              ) : (
                <span className="text-xs text-ink-soft">
                  Official guidebook publication pending
                </span>
              )}
            </div>
            <p className="mt-2 text-ink-soft">{assignment.message}</p>
            {period.contentState !== "demo" && <p className="mt-2 text-ink-soft">For the official catalogue, all 12 sub-divisions other than Relations &amp; Partnership require one first-preference assignment PDF (max 3 MiB). No assignment is accepted for Relations &amp; Partnership.</p>}
            {period.contentState !== "demo" && assignment.upload && <p className="mt-2 text-ink-soft">Include any applicable video, portfolio or external submission links inside the PDF. Filename recommendations are advisory.</p>}
          </div>
          {assignment.upload && (
            <FileField
              key={`${period.id}-${division?.id}-${subDivision?.id}`}
              slot={{ key: fields.assignment, label: "First preference assignment" }}
              upload={assignment.upload}
              required={assignment.required}
              file={files[fields.assignment]}
              error={errors[fields.assignment]}
              onChange={onFile}
            />
          )}
        </>
      ) : (
        <div role="status" aria-live="polite" className="rounded-2xl bg-[#f0eefb] p-4 sm:p-5 text-[15px] leading-relaxed">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-semibold text-ink-deep">Assignment · Second preference: Not required</p>
            {OFFICIAL_GUIDEBOOK_URL ? (
              <a
                href={OFFICIAL_GUIDEBOOK_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#5947b5] hover:text-[#43358b] hover:underline focus-visible:outline-2 focus-visible:outline-iris"
              >
                View Guidebook <span aria-hidden="true">↗</span>
              </a>
            ) : (
              <span className="text-xs text-ink-soft">
                Official guidebook publication pending
              </span>
            )}
          </div>
          <p className="mt-2 text-ink-soft">
            Assignments only apply to your first preference choice. No assignment is required or accepted for your second preference.
          </p>
        </div>
      )}
    </div>
  );
}
