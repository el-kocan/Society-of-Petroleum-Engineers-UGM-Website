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
  if (!slot) return "Check the assignment requirements for your selected sub-division.";
  return validateUpload(file, { formats: [slot.format === "PDF" ? "pdf" : "png"], maxBytes: MAX_FILE_BYTES, filename: slot.filename }, true);
}

export function validateStep(step: number, values: ApplicationValues, files: ApplicationFiles, period: RecruitmentPeriod = recruitmentCatalogs.draft, forSubmission = false): Errors {
  const errors: Errors = {};
  if (step === 0) {
    for (const key of ["fullName", "nim", "birthPlace", "major"] as const) {
      if (!values[key].trim()) errors[key] = "This field is required.";
      else if (values[key].trim().length > 150) errors[key] = "Use no more than 150 characters.";
    }
    const birth = new Date(`${values.birthDate}T00:00:00Z`);
    const today = new Date();
    const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.birthDate) || !Number.isFinite(birth.getTime()) || birth.toISOString().slice(0, 10) !== values.birthDate || values.birthDate > localToday) {
      errors.birthDate = "Enter a valid date of birth that is not in the future.";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.ugmEmail.trim()) || values.ugmEmail.length > 254) errors.ugmEmail = "Enter a valid email address.";
    if (!/^\+?[\d ()-]{8,25}$/.test(values.phoneNumber.trim()) || values.phoneNumber.replace(/\D/g, "").length < 8) errors.phoneNumber = "Enter a phone number with 8–25 characters.";
    if (!period.batches.includes(values.batch)) errors.batch = `Choose a cohort: ${period.batches.join(" or ")}.`;
  }
  if (step === 1 || step === 2) {
    const fields = preferenceFields[step];
    const { division, subDivision } = resolvePreference(period, values[fields.division], values[fields.subDivision]);
    if (!division) errors[fields.division] = "Choose a main division from the list.";
    if (!subDivision) errors[fields.subDivision] = "Choose a sub-division within this main division.";
    if (subDivision && values.division1 === values.division2 && values.subDivision1 === values.subDivision2) {
      errors[fields.subDivision] = "Choose two different sub-divisions. They may belong to the same main division.";
    }
    if (!values[fields.motivation].trim()) errors[fields.motivation] = "Explain why you chose this sub-division.";
    else if (values[fields.motivation].length > 3000) errors[fields.motivation] = "Use no more than 3,000 characters.";
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
