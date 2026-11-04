import type { AssignmentRule, RecruitmentPeriod, UploadSpecification } from "./recruitment-types";

export const uploadFormats = {
  pdf: { label: "PDF", mime: "application/pdf", extension: ".pdf" },
  png: { label: "PNG", mime: "image/png", extension: ".png" },
  ppt: { label: "PowerPoint (.ppt)", mime: "application/vnd.ms-powerpoint", extension: ".ppt" },
  pptx: { label: "PowerPoint (.pptx)", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", extension: ".pptx" },
} as const;

export function resolvePreference(period: RecruitmentPeriod, divisionId: string, subDivisionId: string) {
  const division = period.divisions.find((item) => item.id === divisionId);
  const subDivision = division?.subDivisions.find((item) => item.id === subDivisionId);
  return { division, subDivision };
}

export function uploadHint(upload: UploadSpecification) {
  return `${upload.formats.map((format) => uploadFormats[format].label).join(" / ")} · max ${upload.maxBytes / (1024 * 1024)} MiB. Suggested filename: ${upload.filename}.`;
}

export function uploadAccept(upload: UploadSpecification) {
  return upload.formats.flatMap((format) => [uploadFormats[format].extension, uploadFormats[format].mime]).join(",");
}

export function validateUpload(file: File | undefined, upload: UploadSpecification, required: boolean): string | undefined {
  if (!file) return required ? "Choose a file to continue." : undefined;
  if (file.size === 0) return "This file is empty. Choose another file.";
  if (file.size > upload.maxBytes) return `This file exceeds the ${upload.maxBytes / (1024 * 1024)} MiB limit.`;
  if (!upload.formats.some((format) => file.name.toLowerCase().endsWith(uploadFormats[format].extension) && file.type === uploadFormats[format].mime)) {
    return `Choose a ${upload.formats.map((format) => uploadFormats[format].label).join(" / ")} file with a matching file type.`;
  }
}

export function assignmentView(rule: AssignmentRule | undefined, file?: File) {
  if (!rule) return { upload: undefined, required: false, blocked: true, label: "Choose a sub-division", message: "Choose a main division and sub-division to see assignment requirements.", summary: "No sub-division selected" };
  switch (rule.status) {
    case "required":
      return { upload: rule.upload, required: true, blocked: false, label: "Required", message: rule.instructions, summary: file ? `Required · ${file.name}` : "Not attached (required)" };
    case "optional":
      return { upload: rule.upload, required: false, blocked: false, label: "Optional", message: rule.instructions, summary: file ? `Optional · ${file.name}` : "Not attached (optional)" };
    case "none":
      return { upload: undefined, required: false, blocked: false, label: "Not required", message: rule.message, summary: "Assignment tidak diperlukan / No assignment required" };
    case "unconfirmed":
      return { upload: undefined, required: false, blocked: true, label: "Unconfirmed", message: rule.message, summary: "Belum dikonfirmasi — pengiriman diblokir / Unconfirmed — submission blocked" };
  }
}

export function validateAssignment(rule: AssignmentRule | undefined, file: File | undefined, forSubmission: boolean) {
  const view = assignmentView(rule, file);
  if (view.blocked) return forSubmission ? view.message : undefined;
  return view.upload ? validateUpload(file, view.upload, view.required) : undefined;
}
