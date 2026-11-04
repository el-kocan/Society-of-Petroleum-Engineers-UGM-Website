export type UploadFormat = "pdf" | "png" | "ppt" | "pptx";

export type UploadSpecification = {
  formats: readonly [UploadFormat, ...UploadFormat[]];
  maxBytes: number;
  filename: string;
};

export type AssignmentRule =
  | {
      status: "required" | "optional";
      instructions: string;
      upload: UploadSpecification;
    }
  | { status: "none"; message: string }
  | { status: "unconfirmed"; message: string };

export type SubDivision = {
  id: string;
  label: string;
  assignment: AssignmentRule;
};

export type MainDivision = {
  id: string;
  label: string;
  subDivisions: readonly SubDivision[];
};

export type RecruitmentPeriod = {
  id: string;
  label: string;
  contentState: "draft" | "demo" | "approved";
  notice: string;
  batches: readonly string[];
  documents?: Partial<Record<"cv" | "idCard" | "commitment" | "followProof" | "storyProof" | "mbti" | "ugmGroupProof", UploadSpecification & { required: boolean }>>;
  divisions: readonly MainDivision[];
};

export type PreferenceRank = 1 | 2;

export const preferenceFields = {
  1: { division: "division1", subDivision: "subDivision1", motivation: "motivation1", assignment: "assignment1", label: "pertama" },
  2: { division: "division2", subDivision: "subDivision2", motivation: "motivation2", assignment: "assignment2", label: "kedua" },
} as const;
