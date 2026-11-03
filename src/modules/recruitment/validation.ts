import { documentSlots, MAX_FILE_BYTES, recruitmentCatalogs } from "./config";
import { resolvePreference, validateAssignment, validateUpload } from "./assignment";
import { preferenceFields, type RecruitmentPeriod } from "./recruitment-types";

export type DocumentKey = (typeof documentSlots)[number]["key"] | "assignment1" | "assignment2";
export type ApplicationValues = {
  fullName: string;
  nim: string;
  birthPlace: string;
  birthDate: string;
  ugmEmail: string;
  phoneNumber: string;
  major: string;
  batch: string;
  division1: string;
  subDivision1: string;
  motivation1: string;
  division2: string;
  subDivision2: string;
  motivation2: string;
};
export type ApplicationFiles = Partial<Record<DocumentKey, File>>;
export type Errors = Partial<Record<keyof ApplicationValues | DocumentKey, string>>;

export const emptyValues: ApplicationValues = {
  fullName: "", nim: "", birthPlace: "", birthDate: "", ugmEmail: "",
  phoneNumber: "", major: "", batch: "", division1: "", subDivision1: "", motivation1: "",
  division2: "", subDivision2: "", motivation2: "",
};

export function validateFile(key: DocumentKey, file: File | undefined): string | undefined {
  const slot = documentSlots.find((item) => item.key === key);
  if (!slot) return "Ketentuan assignment harus diperiksa melalui sub-divisi yang dipilih.";
  return validateUpload(file, { formats: [slot.format === "PDF" ? "pdf" : "png"], maxBytes: MAX_FILE_BYTES, filename: slot.filename }, true);
}

export function validateStep(step: number, values: ApplicationValues, files: ApplicationFiles, period: RecruitmentPeriod = recruitmentCatalogs.draft, forSubmission = false): Errors {
  const errors: Errors = {};
  if (step === 0) {
    for (const key of ["fullName", "nim", "birthPlace", "major"] as const) {
      if (!values[key].trim()) errors[key] = "Field ini wajib diisi.";
      else if (values[key].trim().length > 150) errors[key] = "Maksimum 150 karakter.";
    }
    const birth = new Date(`${values.birthDate}T00:00:00Z`);
    const today = new Date();
    const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.birthDate) || !Number.isFinite(birth.getTime()) || birth.toISOString().slice(0, 10) !== values.birthDate || values.birthDate > localToday) {
      errors.birthDate = "Masukkan tanggal lahir yang valid, bukan tanggal mendatang.";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.ugmEmail.trim()) || values.ugmEmail.length > 254) errors.ugmEmail = "Masukkan alamat email yang valid.";
    if (!/^\+?[\d ()-]{8,25}$/.test(values.phoneNumber.trim()) || values.phoneNumber.replace(/\D/g, "").length < 8) errors.phoneNumber = "Masukkan nomor telepon dengan 8–25 karakter.";
    if (!period.batches.includes(values.batch)) errors.batch = `Pilih angkatan ${period.batches.join(" atau ")}.`;
  }
  if (step === 1 || step === 2) {
    const fields = preferenceFields[step];
    const { division, subDivision } = resolvePreference(period, values[fields.division], values[fields.subDivision]);
    if (!division) errors[fields.division] = "Pilih divisi utama dari daftar yang tersedia.";
    if (!subDivision) errors[fields.subDivision] = "Pilih sub-divisi yang termasuk dalam divisi utama ini.";
    if (subDivision && values.division1 === values.division2 && values.subDivision1 === values.subDivision2) {
      errors[fields.subDivision] = "Pilih dua sub-divisi yang berbeda. Keduanya boleh berada dalam divisi utama yang sama.";
    }
    if (!values[fields.motivation].trim()) errors[fields.motivation] = "Tuliskan alasan memilih sub-divisi.";
    else if (values[fields.motivation].length > 3000) errors[fields.motivation] = "Maksimum 3.000 karakter.";
    if (step === 1 && subDivision) {
      const error = validateAssignment(subDivision.assignment, files[fields.assignment], forSubmission);
      if (error) {
        const key = subDivision.assignment.status === "unconfirmed" ? fields.subDivision : fields.assignment;
        errors[key] ??= error;
      }
    }
  }
  for (const slot of documentSlots.filter((item) => item.step === step)) {
    const rule = period.documents?.[slot.key];
    const error = rule ? validateUpload(files[slot.key], rule, rule.required) : validateFile(slot.key, files[slot.key]);
    if (error) errors[slot.key] = error;
  }
  return errors;
}

export function validateSubmission(values: ApplicationValues, files: ApplicationFiles, period: RecruitmentPeriod): Errors {
  return Object.assign({}, ...[0, 1, 2, 3].map((step) => validateStep(step, values, files, period, true)));
}
