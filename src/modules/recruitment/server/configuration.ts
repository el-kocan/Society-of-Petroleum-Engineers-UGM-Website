import "server-only";
import type { RecruitmentPeriod, UploadFormat } from "../recruitment-types";
import type { DocumentKey } from "../validation";
import { SubmissionError } from "./security";

export type PeriodRow = { id: string; label: string; config_version: number; approved_at: string | null; is_open: boolean; opens_at: string; closes_at: string; batches: string[] };
export type OptionRow = { main_code: string; sub_code: string; main_label: string; sub_label: string; assignment_state: "required" | "optional" | "none" | "unconfirmed"; instructions: string; formats: UploadFormat[] | null; max_bytes: number | null };
export type RequirementRow = { slot: DocumentKey; required: boolean; formats: UploadFormat[]; max_bytes: number };
export type Catalog = { period: PeriodRow; options: OptionRow[]; requirements: RequirementRow[] };
export function assertOpen(catalog: Catalog, now = Date.now()) {
  const p = catalog.period;
  if (!p.approved_at || !p.is_open || now < Date.parse(p.opens_at) || now >= Date.parse(p.closes_at))
    throw new SubmissionError(409, "Pendaftaran belum dibuka atau sudah ditutup.");
  if (catalog.options.length === 0 || catalog.options.some(o => o.assignment_state === "unconfirmed") || catalog.requirements.length !== 5)
    throw new SubmissionError(503, "Konfigurasi pendaftaran belum disahkan lengkap.");
}
export function publicPeriod(catalog: Catalog): RecruitmentPeriod {
  const divisions: RecruitmentPeriod["divisions"][number][] = [];
  for (const o of catalog.options) {
    let division = divisions.find(d => d.id === o.main_code);
    if (!division) { division = { id: o.main_code, label: o.main_label, subDivisions: [] }; divisions.push(division); }
    const assignment = o.assignment_state === "required" || o.assignment_state === "optional"
      ? { status: o.assignment_state, instructions: o.instructions, upload: { formats: o.formats as [UploadFormat, ...UploadFormat[]], maxBytes: o.max_bytes!, filename: "Name_FirstDivision.pdf" } }
      : { status: o.assignment_state, message: o.instructions };
    (division.subDivisions as Array<typeof division.subDivisions[number]>).push({ id: o.sub_code, label: o.sub_label, assignment });
  }
  return { id: catalog.period.id, label: catalog.period.label, contentState: "approved", notice: "Konfigurasi pendaftaran resmi dari panitia.", batches: catalog.period.batches, divisions,
    documents: Object.fromEntries(catalog.requirements.map(r => [r.slot, { required: r.required, formats: r.formats, maxBytes: r.max_bytes, filename: r.slot }])) };
}
