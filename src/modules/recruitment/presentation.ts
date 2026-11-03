import { assignmentView } from "./assignment";
import type { AssignmentRule } from "./recruitment-types";
import type { UploadSpecification } from "./recruitment-types";

/** Frontend copy only. Configuration values and backend text stay unchanged. */
export const steps = ["Personal information", "First preference", "Second preference", "Supporting documents"] as const;
export const PREVIEW_NOTICE = "Local preview only. No application data or files are submitted.";

export function preferenceLabel(rank: 1 | 2) {
  return rank === 1 ? "first" : "second";
}

const documentLabels: Record<string, string> = {
  cv: "Curriculum Vitae",
  idCard: "Student ID Card (KTM / eKTM)",
  commitment: "Commitment Letter",
  followProof: "Instagram Follow Proof",
  storyProof: "Instagram Story Proof",
};

export function documentLabel(key: string) {
  return documentLabels[key] ?? key;
}

/** Advisory filename only; retain every server-provided upload restriction. */
export function documentUploadHint(upload: UploadSpecification, suggestedFilename: string): UploadSpecification {
  return { ...upload, filename: suggestedFilename };
}

const previewCopy: Record<string, string> = {
  "Daftar divisi dari draft guidebook, belum menjadi data rekrutmen yang disahkan. Seluruh aturan assignment masih menunggu konfirmasi panitia.": "Draft catalogue. Assignment requirements are awaiting committee confirmation, so final submission is blocked.",
  "Data contoh UX. Semua nama dan aturan di katalog ini sintetis untuk mencoba empat perilaku assignment, bukan ketentuan organisasi.": "Synthetic examples for testing assignment states. These are not official recruitment requirements.",
  "Ketentuan assignment dan format file belum dikonfirmasi panitia. Submit simulasi diblokir untuk pilihan ini.": "Assignment requirements and file formats are unconfirmed. Preview submission is blocked for this choice.",
  "Divisi contoh A": "Example Division A",
  "Divisi contoh B": "Example Division B",
  "Contoh: assignment wajib": "Example: required assignment",
  "Contoh: assignment opsional": "Example: optional assignment",
  "Contoh: tanpa assignment": "Example: no assignment",
  "Contoh: belum dikonfirmasi": "Example: unconfirmed requirements",
  "Contoh UX saja: pilih PDF contoh untuk mencoba assignment wajib. Ini bukan tugas rekrutmen resmi.": "Upload a sample PDF to test a required assignment. This is not an official recruitment task.",
  "Contoh UX saja: PDF contoh boleh dilampirkan atau dilewati. Jika dilampirkan, file harus valid.": "A sample PDF is optional. Any file you choose must meet the listed requirements.",
  "Tidak ada assignment untuk sub-divisi contoh ini. Tidak perlu memilih file.": "No assignment is needed for this example sub-division.",
  "Contoh UX: aturan belum dikonfigurasi. Submit simulasi diblokir sampai ketentuan tersedia atau pilihan diubah.": "Requirements are unconfirmed. Preview submission is blocked until they are confirmed or you choose another sub-division.",
};

/** Use only for local preview copy, never API response text. */
export function previewText(text: string | undefined) {
  return text === undefined ? undefined : previewCopy[text] ?? text;
}

const clientCopy: Record<string, string> = {
  "Pilih dokumen untuk melanjutkan.": "Choose a file to continue.",
  "File kosong. Pilih file lain.": "This file is empty. Choose another file.",
  "Ketentuan assignment harus diperiksa melalui sub-divisi yang dipilih.": "Check the assignment requirements for your selected sub-division.",
  "Field ini wajib diisi.": "This field is required.",
  "Maksimum 150 karakter.": "Use no more than 150 characters.",
  "Masukkan tanggal lahir yang valid, bukan tanggal mendatang.": "Enter a valid date of birth that is not in the future.",
  "Masukkan alamat email yang valid.": "Enter a valid email address.",
  "Masukkan nomor telepon dengan 8–25 karakter.": "Enter a phone number with 8–25 characters and at least 8 digits.",
  "Masukkan nomor telepon dengan 8â€“25 karakter.": "Enter a phone number with 8–25 characters and at least 8 digits.",
  "Pilih divisi utama dari daftar yang tersedia.": "Choose a main division from the list.",
  "Pilih sub-divisi yang termasuk dalam divisi utama ini.": "Choose a sub-division within this main division.",
  "Pilih dua sub-divisi yang berbeda. Keduanya boleh berada dalam divisi utama yang sama.": "Choose two different sub-divisions. They may belong to the same main division.",
  "Tuliskan alasan memilih sub-divisi.": "Explain why you chose this sub-division.",
  "Maksimum 3.000 karakter.": "Use no more than 3,000 characters.",
};

/** Translate locally generated feedback before storing it; API errors bypass this. */
export function clientMessage(message: string, preview = false): string {
  if (clientCopy[message]) return clientCopy[message];
  if (message.startsWith("Masukkan nomor telepon dengan ")) return clientCopy["Masukkan nomor telepon dengan 8–25 karakter."];
  const size = /^File melebihi batas (.+) MiB\.$/.exec(message);
  if (size) return `This file exceeds the ${size[1]} MiB limit.`;
  const format = /^Gunakan file (.+) dengan tipe yang sesuai\.$/.exec(message);
  if (format) return `Choose a ${format[1]} file with a matching file type.`;
  const batch = /^Pilih angkatan (.+)\.$/.exec(message);
  if (batch) return `Choose a cohort: ${batch[1].replaceAll(" atau ", " or ")}.`;
  return preview ? previewText(message)! : message;
}

export function assignmentPresentation(rule: AssignmentRule | undefined, file: File | undefined, preview: boolean) {
  const view = assignmentView(rule, file);
  const labels: Record<string, string> = {
    "Belum dipilih": "Choose a sub-division",
    "Wajib": "Required",
    "Opsional": "Optional",
    "Tidak diperlukan": "Not required",
    "Belum dikonfirmasi": "Unconfirmed",
  };
  const summaries: Record<string, string> = {
    "Sub-divisi belum dipilih": "No sub-division selected",
    "Belum dilampirkan (wajib)": "Not attached (required)",
    "Tidak dilampirkan (opsional)": "Not attached (optional)",
    "Assignment tidak diperlukan": "No assignment required",
    "Belum dikonfirmasi — pengiriman diblokir": "Unconfirmed — submission blocked",
  };
  return {
    ...view,
    label: labels[view.label] ?? view.label,
    summary: file && view.upload
      ? `${view.required ? "Required" : "Optional"} · ${file.name}`
      : summaries[view.summary] ?? view.summary,
    message: !rule
      ? "Choose a main division and sub-division to see assignment requirements."
      : preview ? previewText(view.message) : view.message,
  };
}
