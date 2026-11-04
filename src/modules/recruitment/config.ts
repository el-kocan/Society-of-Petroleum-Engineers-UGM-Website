/** Phase A only. No environment variables, remote configuration, or backend. */
import { draftPeriod } from "./draft-config";
import { mockPeriod } from "./mock-config";
import type { RecruitmentPeriod } from "./recruitment-types";

export type RecruitmentStatus = "open" | "closed" | "pending";

// No official catalogue or assignment policy has been approved in this phase.
// Future periods get their own key; do not overwrite a previous period's data.
export const approvedRecruitmentPeriods: Readonly<Record<string, RecruitmentPeriod & { contentState: "approved" }>> = {};

export const recruitmentCatalogs = { draft: draftPeriod, demo: mockPeriod };
export type RecruitmentCatalog = keyof typeof recruitmentCatalogs;

export const recruitmentConfig: {
  period: string;
  status: RecruitmentStatus;
  divisions: RecruitmentPeriod["divisions"];
} = {
  period: draftPeriod.label,
  status: "open",
  divisions: draftPeriod.divisions,
};

export const statusLabels: Record<RecruitmentStatus, string> = {
  open: "Applications Open",
  closed: "Applications Closed",
  pending: "Information Pending Confirmation",
};

export const MOCK_NOTICE = "Local simulation — no data submitted.";
export const MAX_FILE_BYTES = 3 * 1024 * 1024;

export const documentSlots = [
  { key: "cv", label: "Curriculum Vitae", format: "PDF", filename: "Name_CV.pdf", step: 3 },
  { key: "idCard", label: "Student ID Card (KTM / eKTM)", format: "PDF", filename: "Name_IDCard.pdf", step: 3 },
  { key: "commitment", label: "Commitment Letter", format: "PDF", filename: "Name_LetterCommitment.pdf", step: 3 },
  { key: "followProof", label: "Instagram Follow Proof", format: "PNG", filename: "Name_ProofFollowSPE.png", step: 3 },
  { key: "storyProof", label: "Instagram Story Proof", format: "PNG", filename: "Name_ProofSG.png", step: 3 },
] as const;

export const steps = ["Personal information", "First preference", "Second preference", "Supporting documents & review"] as const;
