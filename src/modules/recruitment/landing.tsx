import Image from "next/image";

import { ApplicationEntry, MockNotice, RecruitmentFrame, secondaryButton } from "./components";
import { OFFICIAL_GUIDEBOOK_URL, PUBLIC_RECRUITMENT_SCHEDULE } from "./public-information";
export { OFFICIAL_GUIDEBOOK_URL } from "./public-information";

interface TimelineStage {
  date: string;
  title: string;
}

const RECRUITMENT_TIMELINE: readonly TimelineStage[] = [
  {
    date: PUBLIC_RECRUITMENT_SCHEDULE.applicationDates,
    title: "Staff Application Period",
  },
  {
    date: "November 14, 2026",
    title: "Document Screening Announcement",
  },
  {
    date: "November 15, 2026",
    title: "Focus Group Discussion",
  },
  {
    date: "November 16, 2026",
    title: "FGD Qualifiers Announcement",
  },
  {
    date: "Nov 18 – 20, 2026",
    title: "Offline Interviews",
  },
  {
    date: "November 22, 2026",
    title: "Final Staff Announcement",
  },
] as const;

interface DivisionMandate {
  id: string;
  name: string;
  subDivisions: readonly string[];
}

const CONFIRMED_DIVISIONS: readonly DivisionMandate[] = [
  {
    id: "internal-affairs",
    name: "Internal Affairs",
    subDivisions: ["Human Capital", "Internal Engagement"],
  },
  {
    id: "external-affairs",
    name: "External Affairs",
    subDivisions: ["Relations & Partnership", "External Engagement"],
  },
  {
    id: "research-education",
    name: "Research & Education",
    subDivisions: ["Research & Exploration", "Education & Professional Growth"],
  },
  {
    id: "compdev-iem",
    name: "Compdev & IEM",
    subDivisions: ["Competency Development", "International Event Manager"],
  },
  {
    id: "finance",
    name: "Finance",
    subDivisions: ["Sponsorship", "Fundraising"],
  },
  {
    id: "media-creative",
    name: "Media Creative",
    subDivisions: ["Visual Design", "Documentation", "Website Development"],
  },
] as const;

const SUPPORTING_DOCUMENTS = [
  { name: "Curriculum Vitae", format: "PDF", filename: "Name_CV.pdf" },
  { name: "Student ID Card (KTM / eKTM)", format: "PDF", filename: "Name_IDCard.pdf" },
  { name: "Commitment Letter", format: "PDF", filename: "Name_LetterCommitment.pdf" },
  { name: "Instagram Follow Proof", format: "PNG", filename: "Name_ProofFollowSPE.png" },
  { name: "Instagram Story Proof", format: "PNG", filename: "Name_ProofSG.png" },
] as const;

const sectionStyle = "scroll-mt-28 border-t border-[#dddde8] py-5 sm:py-10";
const headingStyle = "font-display text-2xl font-semibold tracking-tight text-ink-deep sm:text-3xl";

export function RecruitmentLanding({ backend = false }: { backend?: boolean } = {}) {
  return (
    <RecruitmentFrame>
      {!backend && <MockNotice />}

      <section aria-labelledby="recruitment-title" className="grid gap-6 pt-2 pb-7 sm:pt-4 sm:pb-10 lg:grid-cols-[1.25fr_1fr] lg:items-center lg:gap-12">
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-[#5947b5]">
            SPE UGM SC Staff Recruitment 2026/2027
          </p>
          <h1
            id="recruitment-title"
            className="mt-4 font-display text-[2.5rem] leading-[1.12] font-semibold tracking-tight text-ink-deep sm:text-6xl lg:text-[3.25rem] xl:text-[3.5rem]"
          >
            Your next chapter<br />
            <span className="text-iris">starts here.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-ink-soft">
            {backend
              ? "Build your skills, connect with the energy community, and shape SPE UGM SC. Apply with your preferred sub-divisions and supporting documents."
              : "Explore the roles, selection dates, and documents to prepare for your next chapter with SPE UGM SC. Applications are currently in preview mode."}
          </p>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-ink-soft">
            Open to UGM students from Engineering, Mathematics and Natural Sciences, or Vocational School, cohorts 2025 and 2026.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <ApplicationEntry backend={backend} />
            {OFFICIAL_GUIDEBOOK_URL ? (
              <a
                href={OFFICIAL_GUIDEBOOK_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={secondaryButton}
              >
                Read Guidebook
              </a>
            ) : (
              <button
                type="button"
                disabled
                aria-describedby="guidebook-status"
                className={`${secondaryButton} disabled:cursor-not-allowed disabled:text-ink-soft`}
              >
                Read Guidebook
              </button>
            )}
          </div>
          {!OFFICIAL_GUIDEBOOK_URL && (
            <p id="guidebook-status" className="mt-3 text-[15px] text-ink-soft">
              Official guidebook publication pending.
            </p>
          )}
        </div>
        <figure className="min-w-0">
          <div className="relative h-36 overflow-hidden rounded-[22px] bg-[#e8e7ee] sm:h-56 lg:h-auto lg:aspect-[4/3]">
            <Image
              src="/About/about.webp"
              alt="SPE UGM Student Chapter members gathered on campus steps"
              fill
              sizes="(min-width: 1024px) 1280px, 135vw"
              loading="eager"
              className="translate-y-[8%] scale-[1.35] object-cover"
            />
          </div>
          <figcaption className="mt-3 flex items-center gap-3 text-[15px] text-ink-soft">
            <span aria-hidden="true" className="h-px w-8 shrink-0 bg-[#8879cb]" />
            The SPE UGM SC community
          </figcaption>
        </figure>
      </section>

      <section id="timeline" aria-labelledby="timeline-title" className={sectionStyle}>
        <h2 id="timeline-title" className={headingStyle}>Recruitment Timeline</h2>
        <p className="mt-3 text-[15px] text-ink-soft">Application deadline: {PUBLIC_RECRUITMENT_SCHEDULE.deadline}.</p>
        <ol className="mt-5 grid gap-x-12 sm:grid-flow-col sm:grid-cols-2 sm:grid-rows-3">
          {RECRUITMENT_TIMELINE.map((stage, index) => (
            <li key={stage.title} className="relative grid grid-cols-[2rem_1fr] gap-3 py-2.5 before:absolute before:top-10 before:bottom-0 before:left-3 before:border-l before:border-[#d4cdeb] last:before:hidden sm:py-3.5 sm:before:top-11 sm:[&:nth-child(3)]:before:hidden">
              <span aria-hidden="true" className="pt-0.5 font-mono text-sm font-medium text-[#5947b5]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <p className="text-[15px] font-medium text-[#5947b5]">{stage.date}</p>
                <h3 className="mt-1 text-base font-semibold text-ink-deep">{stage.title}</h3>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section id="divisions" aria-labelledby="divisions-title" className={sectionStyle}>
        <h2 id="divisions-title" className={headingStyle}>Divisions &amp; Sub-Divisions</h2>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
          Choose up to two distinct sub-divisions.
        </p>
        <div className="mt-5 grid gap-x-12 sm:grid-cols-2">
          {CONFIRMED_DIVISIONS.map((division, index) => (
            <div key={division.id} className="grid grid-cols-[2rem_1fr] gap-3 border-b border-[#dddde8] py-2 sm:py-4">
              <span aria-hidden="true" className="pt-1 font-mono text-sm text-[#65578c]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <h3 className="font-display text-lg font-semibold tracking-tight text-ink-deep">{division.name}</h3>
                <ul className="mt-1.5 space-y-0.5 text-[15px] leading-relaxed text-ink-soft">
                  {division.subDivisions.map((sub) => <li key={sub}>{sub}</li>)}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="documents" aria-labelledby="documents-title" className={sectionStyle}>
        <div className="grid gap-5 rounded-3xl bg-[#f0eefb] p-5 sm:p-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-10">
          <div>
            <h2 id="documents-title" className={headingStyle}>Before You Apply</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
              Prepare these five supporting documents, max 3 MiB each. Filenames are guidance only.
            </p>
            <p className="mt-4 text-[15px] leading-relaxed text-ink-soft">
              Your first preference requires an assignment PDF (max 3 MiB), except Relations &amp; Partnership. No assignment is accepted for your second preference. Suggested filename (advisory): Name_FirstDivision.pdf. Include any applicable video, portfolio or external submission links inside the PDF.
            </p>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
              {OFFICIAL_GUIDEBOOK_URL ? "Read the official guidebook for the assignment briefs." : "Assignment briefs will be available in the official guidebook. Publication is pending."}
            </p>
          </div>
          <ul className="grid min-w-0 gap-2.5 sm:grid-cols-2 sm:gap-3">
            {SUPPORTING_DOCUMENTS.map((document) => (
              <li key={document.filename} className="min-w-0 rounded-2xl bg-white p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-[15px] leading-snug font-semibold text-ink-deep">{document.name}</h3>
                  <span className="shrink-0 pt-0.5 text-xs font-semibold text-[#5947b5]">{document.format}</span>
                </div>
                <p className="mt-2 font-mono text-[13px] leading-relaxed break-all text-ink-soft">
                  {document.filename}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section
        id="ready-to-join"
        aria-labelledby="ready-to-join-title"
        className="mt-8 rounded-3xl border border-[#dcddea] bg-white p-6 sm:p-10 shadow-[0_2px_12px_rgba(40,24,96,0.04)]"
      >
        <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <div className="max-w-xl">
            <p className="text-xs font-semibold tracking-[0.15em] text-iris uppercase">
              Recruitment 2026/2027
            </p>
            <h2
              id="ready-to-join-title"
              className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink-deep sm:text-3xl"
            >
              Ready to Join SPE UGM SC?
            </h2>
            <p className="mt-2 text-base leading-relaxed text-ink-soft">
              Take the next step and become part of our community.
            </p>
          </div>
          <div className="shrink-0">
            <ApplicationEntry backend={backend} />
          </div>
        </div>
      </section>
    </RecruitmentFrame>
  );
}
