import "server-only";
import { createHash } from "node:crypto";
import { emptyValues, type ApplicationValues, type DocumentKey } from "../validation";
import { documentSlots } from "../config";
import { validateStep } from "../validation";
import { publicPeriod, type Catalog } from "./configuration";
import { SubmissionError } from "./security";

export type VerifiedDocument = { slot: DocumentKey; format: "pdf" | "png"; mime: string; bytes: Buffer; sha256: string };
export type Payload = { values: ApplicationValues; documents: VerifiedDocument[]; hash: string };
export function inspectDocument(bytes: Buffer, name: string, mime: string): "pdf" | "png" {
  if (name.toLowerCase().endsWith(".pdf") && mime === "application/pdf" && /^%PDF-(?:1\.[0-7]|2\.0)/.test(bytes.subarray(0, 8).toString()) && /%%EOF\s*$/.test(bytes.subarray(-1024).toString())) {
    // Disallow interactive/embedded content. This is a structural precheck,
    // not malware certification; documents stay private and download-only.
    const text = bytes.toString("latin1").replace(/#([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    if (/\/(JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA|RichMedia|Encrypt)\b/.test(text)) throw new SubmissionError(422, "PDF interaktif atau terenkripsi tidak didukung.");
    return "pdf";
  }
  if (name.toLowerCase().endsWith(".png") && mime === "image/png" && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    let offset = 8; let first = true; let imageData = false;
    while (offset + 12 <= bytes.length) {
      const size = bytes.readUInt32BE(offset); const type = bytes.toString("ascii", offset + 4, offset + 8);
      if (offset + size + 12 > bytes.length || !/^[A-Za-z]{4}$/.test(type)) break;
      if (first && (type !== "IHDR" || size !== 13 || bytes.readUInt32BE(offset + 8) === 0 || bytes.readUInt32BE(offset + 12) === 0 || bytes.readUInt32BE(offset + 8) * bytes.readUInt32BE(offset + 12) > 25000000)) break;
      let crc = 0xffffffff;
      for (const byte of bytes.subarray(offset + 4, offset + 8 + size)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
      if (((crc ^ 0xffffffff) >>> 0) !== bytes.readUInt32BE(offset + 8 + size)) break;
      if (type === "IDAT" && size > 0) imageData = true;
      offset += size + 12; first = false;
      if (type === "IEND" && imageData && size === 0 && offset === bytes.length) return "png";
    }
  }
  throw new SubmissionError(422, "Isi file tidak sesuai PDF/PNG yang didukung.");
}
export async function validatePayload(form: FormData, catalog: Catalog): Promise<Payload> {
  const allowed = new Set([...Object.keys(emptyValues), ...documentSlots.map(s => s.key), "assignment1", "assignment2"]);
  for (const key of form.keys()) if (!allowed.has(key) || form.getAll(key).length !== 1) throw new SubmissionError(400, "Field pengiriman tidak valid atau berulang.");
  if (form.has("assignment2")) throw new SubmissionError(422, "Assignment tidak diperlukan untuk pilihan kedua.");
  const values = { ...emptyValues };
  for (const key of Object.keys(values) as Array<keyof ApplicationValues>) {
    const value = form.get(key); if (typeof value !== "string" || value.length > 3000) throw new SubmissionError(422, "Data formulir tidak lengkap.");
    values[key] = value.trim();
  }
  values.nim = values.nim.toLowerCase(); values.ugmEmail = values.ugmEmail.toLowerCase();
  const period = publicPeriod(catalog);
  // Personal/preference validation shares Phase A rules; document requirements
  // below are exclusively database configuration, never the draft guidebook.
  const files = Object.fromEntries([...form.entries()].filter(([,v]) => typeof v !== "string"));
  const errors = Object.assign({}, ...[0,1,2].map(step => validateStep(step, values, files, period, true)));
  if (Object.keys(errors).length) throw new SubmissionError(422, "Periksa kembali isian Anda.", errors);
  const requirements = catalog.requirements.map(r => ({ slot: r.slot, formats: r.formats, max: r.max_bytes, required: r.required }));
  const o1 = catalog.options.find(o => o.main_code === values.division1 && o.sub_code === values.subDivision1);
  if (!o1 || o1.assignment_state === "unconfirmed") throw new SubmissionError(422, "Ketentuan assignment belum dikonfirmasi.");
  if (o1.assignment_state === "none") {
    if (form.has("assignment1")) throw new SubmissionError(422, "Assignment tidak diperlukan untuk pilihan ini.");
  } else {
    requirements.push({ slot: "assignment1", formats: o1.formats!, max: o1.max_bytes!, required: o1.assignment_state === "required" });
  }
  const o2 = catalog.options.find(o => o.main_code === values.division2 && o.sub_code === values.subDivision2);
  if (!o2) throw new SubmissionError(422, "Pilihan sub-divisi kedua tidak valid.");

  const documents: VerifiedDocument[] = [];
  for (const r of requirements.sort((a,b) => a.slot.localeCompare(b.slot))) {
    const file = form.get(r.slot);
    if (file === null && !r.required) continue;
    if (!(file instanceof File) || file.size < 1 || file.size > Math.min(r.max,3145728)) throw new SubmissionError(422, "Dokumen wajib belum lengkap atau ukurannya tidak sesuai.", { [r.slot]: "Periksa dokumen dan batas ukuran." });
    const bytes = Buffer.from(await file.arrayBuffer()); const format = inspectDocument(bytes, file.name, file.type);
    if (!r.formats.includes(format)) throw new SubmissionError(422, "Format dokumen tidak sesuai konfigurasi panitia.");
    documents.push({ slot: r.slot, format, mime: file.type, bytes, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  const hash = createHash("sha256").update(JSON.stringify({ period: catalog.period.id, version: catalog.period.config_version, values, documents: documents.map(d => ({ slot:d.slot, format:d.format, size:d.bytes.length, sha256:d.sha256 })) })).digest("hex");
  return { values, documents, hash };
}
