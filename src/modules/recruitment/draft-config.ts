import type { MainDivision, RecruitmentPeriod } from "./recruitment-types";

const upload = {
  formats: ["pdf"] as const,
  maxBytes: 3 * 1024 * 1024,
  filename: "Name_FirstDivision.pdf",
};

const requiredAssignment = {
  status: "required" as const,
  instructions: "Assignment instructions are provided in the official guidebook via linked Google Docs. Submit your completed assignment as a PDF (max 3 MB).",
  upload,
};

const noneAssignment = {
  status: "none" as const,
  message: "No assignment is required for Relations & Partnership.",
};

function division(id: string, label: string, children: readonly [string, string][]): MainDivision {
  return {
    id,
    label,
    subDivisions: children.map(([childId, childLabel]) => ({
      id: childId,
      label: childLabel,
      assignment: childId === "relations-partnership" ? noneAssignment : requiredAssignment,
    })),
  };
}

export const draftPeriod: RecruitmentPeriod = {
  id: "2026-2027",
  label: "2026/2027",
  contentState: "draft",
  notice: "Catalogue aligned with GUIDEBOOK_v3. First preference requires an assignment PDF (max 3 MB) except for Relations & Partnership. Second preference does not require an assignment.",
  batches: ["2025", "2026"],
  divisions: [
    division("internal-affairs", "Internal Affairs", [
      ["human-capital", "Human Capital"],
      ["internal-engagement", "Internal Engagement"],
    ]),
    division("external-affairs", "External Affairs", [
      ["relations-partnership", "Relations & Partnership"],
      ["external-engagement", "External Engagement"],
    ]),
    division("research-education", "Research & Education", [
      ["research-exploration", "Research & Exploration"],
      ["education-professional-growth", "Education & Professional Growth"],
    ]),
    division("compdev-iem", "Compdev & IEM", [
      ["competency-development", "Competency Development"],
      ["international-event-manager", "International Event Manager"],
    ]),
    division("finance", "Finance", [
      ["sponsorship", "Sponsorship"],
      ["fundraising", "Fundraising"],
    ]),
    division("media-creative", "Media Creative", [
      ["visual-design", "Visual design"],
      ["documentation", "Documentation"],
      ["website-development", "Website Development"],
    ]),
  ],
};
