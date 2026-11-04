"use client";

import type { ReactNode } from "react";
import { uploadAccept } from "./assignment";
import type { UploadSpecification } from "./recruitment-types";
import type { DocumentKey } from "./validation";

export function Field({ id, label, error, hint, required = true, children }: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-2 block text-[15px] font-semibold text-ink-deep">
        {label}{required ? <span aria-hidden="true" className="text-iris"> *</span> : " (optional)"}
      </label>
      {children}
      {hint && <p id={`${id}-hint`} className="mt-2 text-sm leading-relaxed text-ink-soft">{hint}</p>}
      {error && <p id={`${id}-error`} className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}

export function FileField({ slot, upload, file, error, required = true, actionLink, guidance, onChange }: {
  slot: { key: DocumentKey; label: string };
  upload: UploadSpecification;
  file?: File;
  error?: string;
  required?: boolean;
  actionLink?: ReactNode;
  guidance?: string;
  onChange: (file?: File) => void;
}) {
  const id = `recruit-${slot.key}`;
  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="text-[15px] font-semibold text-ink-deep">
          {slot.label}{required ? <span aria-hidden="true" className="text-iris"> *</span> : " (optional)"}
        </label>
        {actionLink}
      </div>
      {guidance && (
        <p className="mb-2 text-sm leading-relaxed text-ink-soft">{guidance}</p>
      )}
      <div className={`rounded-2xl border bg-[#faf9fe] p-4 ${error ? "border-red-500" : "border-[#dcddea]"}`}>
        <input
          id={id}
          type="file"
          accept={uploadAccept(upload)}
          aria-required={required}
          aria-invalid={Boolean(error)}
          aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
          className="block w-full min-w-0 rounded-lg text-sm text-ink-soft file:mr-3 file:cursor-pointer file:rounded-xl file:border-0 file:bg-[#ebe6ff] file:px-4 file:py-3 file:text-sm file:font-semibold file:text-[#514096] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-iris"
          onChange={(event) => {
            const picked = event.currentTarget.files?.[0];
            if (picked) onChange(picked);
            event.currentTarget.value = "";
          }}
        />
        {file && (
          <div className="mt-3 flex items-start justify-between gap-3 border-t border-[#e6e5f1] pt-3">
            <p className="min-w-0 text-sm break-all text-ink-deep">
              <span className="font-medium">{file.name}</span>
              <span className="mt-1 block text-sm text-ink-soft">{(file.size / 1024).toFixed(1)} KiB · selected file</span>
            </p>
            <button type="button" onClick={() => onChange()} className="min-h-10 shrink-0 rounded-lg px-2 text-sm font-medium text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-iris" aria-label={`Remove ${slot.label}`}>Remove</button>
          </div>
        )}
      </div>
      <p id={`${id}-hint`} className="mt-2 text-sm leading-relaxed text-ink-soft">
        {upload.formats.map((format) => format.toUpperCase()).join(" / ")} · Max {upload.maxBytes / (1024 * 1024)} MiB. Suggested filename (advisory): {upload.filename}.
      </p>
      {error && <p id={`${id}-error`} className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
