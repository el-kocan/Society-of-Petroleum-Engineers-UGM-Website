/** Centralized committee-confirmed URLs and recruitment schedule. */
export const OFFICIAL_GUIDEBOOK_URL =
  "https://drive.google.com/file/d/1NtZkOohHNQdSOFk4tiRA7Y7Ol6QTDkVo/view?usp=sharing";

export const COMMITMENT_LETTER_TEMPLATE_URL =
  "https://bit.ly/CommitmentLetterSPEUGMSC";

export const PERSONALITY_TEST_URL =
  "https://www.16personalities.com/";

export const RECRUITMENT_TIMESTAMPS = {
  opensAt: "2026-11-05T00:00:00+07:00",
  initialClosesAt: "2026-11-13T00:00:00+07:00",
  extendedClosesAt: "2026-11-14T00:00:00+07:00",
} as const;

export interface PublicRecruitmentSchedule {
  isExtended: boolean;
  isClosed: boolean;
  isBeforeOpen: boolean;
  applicationDates: string;
  deadline: string;
  badge: string | null;
}

export function getPublicRecruitmentSchedule(nowMs: number = Date.now()): PublicRecruitmentSchedule {
  const opensMs = Date.parse(RECRUITMENT_TIMESTAMPS.opensAt);
  const initialClosesMs = Date.parse(RECRUITMENT_TIMESTAMPS.initialClosesAt);
  const extendedClosesMs = Date.parse(RECRUITMENT_TIMESTAMPS.extendedClosesAt);

  const isExtended = nowMs >= initialClosesMs;
  const isClosed = nowMs >= extendedClosesMs;
  const isBeforeOpen = nowMs < opensMs;

  if (isExtended) {
    return {
      isExtended: true,
      isClosed,
      isBeforeOpen,
      applicationDates: "November 5 – 13, 2026 (Extended)",
      deadline: "November 13, 2026, 23:59 WIB",
      badge: isClosed ? "Applications Closed" : "Registration Extended",
    };
  }

  return {
    isExtended: false,
    isClosed: false,
    isBeforeOpen,
    applicationDates: "November 5 – 12, 2026",
    deadline: "November 12, 2026, 23:59 WIB",
    badge: isBeforeOpen ? "Applications Pending" : null,
  };
}

/** Committee-confirmed public schedule, dynamically synchronized with the extension boundary. */
export const PUBLIC_RECRUITMENT_SCHEDULE = {
  get isExtended() {
    return getPublicRecruitmentSchedule().isExtended;
  },
  get isClosed() {
    return getPublicRecruitmentSchedule().isClosed;
  },
  get isBeforeOpen() {
    return getPublicRecruitmentSchedule().isBeforeOpen;
  },
  get applicationDates() {
    return getPublicRecruitmentSchedule().applicationDates;
  },
  get deadline() {
    return getPublicRecruitmentSchedule().deadline;
  },
  get badge() {
    return getPublicRecruitmentSchedule().badge;
  },
};
