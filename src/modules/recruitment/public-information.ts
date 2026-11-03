/** Committee-confirmed public copy, independent of the database's exclusive cutoff. */
export const PUBLIC_RECRUITMENT_SCHEDULE = {
  applicationDates: "Nov 4 – 13, 2026",
  deadline: "November 13, 2026, 23:59 WIB",
} as const;

/** Set only to the committee's verified published guidebook URL; never a placeholder. */
export const OFFICIAL_GUIDEBOOK_URL: string | null = null;
