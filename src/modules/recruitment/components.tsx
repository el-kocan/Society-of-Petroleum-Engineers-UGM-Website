import Link from "next/link";
import type { ReactNode } from "react";

import { recruitmentConfig } from "./config";

export const primaryButton =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-iris px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#5947c7] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-iris disabled:cursor-not-allowed disabled:opacity-50";
export const secondaryButton =
  "inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-[#dcddea] bg-white px-6 py-3 text-sm font-semibold text-ink-deep transition-colors hover:bg-ground hover:border-iris/40 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-iris";
export const inputStyle =
  "min-h-12 w-full rounded-xl border border-[#d7dbe5] bg-white px-4 py-3 text-base text-ink-deep outline-none transition-colors focus:border-iris focus:ring-2 focus:ring-iris/20 aria-invalid:border-red-600 aria-invalid:ring-red-600/15";

export function MockNotice() {
  return (
    <aside
      aria-label="Simulation notice"
      className="mb-8 rounded-2xl border border-iris/20 bg-[#f2efff] px-5 py-4 text-sm leading-relaxed text-[#4a398c]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-iris">Local Simulation — No Data Submitted</p>
        <span className="text-xs font-medium text-ink-soft">Simulation Environment</span>
      </div>
      <p className="mt-1 text-sm text-[#524194]">
        This is an offline frontend preview. No real application data or files will be submitted.
        All entries are reset when you leave or reload the page.
      </p>
    </aside>
  );
}

export function RecruitmentFrame({ children }: { children: ReactNode }) {
  return (
    <main lang="en" className="min-h-svh bg-[#fbfbfe] px-5 pt-32 pb-20 text-ink sm:px-8 md:pt-40">
      <div className="mx-auto max-w-6xl">{children}</div>
    </main>
  );
}

export function StatusBadge({ backend = false }: { backend?: boolean } = {}) {
  let label = "Preview Mode";
  if (backend) {
    label = "Recruitment Live";
  } else if (recruitmentConfig.status === "closed") {
    label = "Applications Closed";
  } else if (recruitmentConfig.status === "pending") {
    label = "Pending Confirmation";
  }

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-iris/20 bg-white px-3.5 py-1.5 text-xs font-semibold text-iris">
      <span aria-hidden="true" className="size-2 rounded-full bg-iris" />
      {label}
    </span>
  );
}

export function ApplicationEntry({ backend = false }: { backend?: boolean } = {}) {
  if (recruitmentConfig.status === "closed") {
    return (
      <button type="button" disabled className={primaryButton}>
        Applications Closed
      </button>
    );
  }

  if (recruitmentConfig.status === "pending") {
    return (
      <span className="text-xs font-semibold text-ink-soft">
        Application schedule under review
      </span>
    );
  }

  const label = backend ? "Apply Now" : "Preview Application Form";

  return (
    <Link href="/join/apply" className={primaryButton}>
      {label} <span aria-hidden="true">→</span>
    </Link>
  );
}
