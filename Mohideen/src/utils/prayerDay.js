/**
 * The day a prayer belongs to, in the user's own timezone.
 *
 * The prayer tracker used `new Date().toISOString().split("T")[0]`, which is the
 * UTC date. In India that means the day only rolls over at 05:30 local — so a
 * Fajr marked at 5:00 AM was filed under *yesterday*, and "today" did not begin
 * at midnight. Anything keyed per-day has to agree with the user's calendar,
 * not with UTC.
 *
 * en-CA formats as YYYY-MM-DD, which sorts correctly and matches the existing
 * key shape, so stored keys stay readable and comparable.
 */

export const localDayKey = (date = new Date()) => date.toLocaleDateString("en-CA");

/** Storage key for a day's prayer tracker. */
export const trackerKeyFor = (dayKey = localDayKey()) => `prayer_tracker_${dayKey}`;

/**
 * Legacy UTC-dated key for the same moment. Read once as a fallback so marks
 * made before this fix are not lost when the key shape changes mid-day.
 */
export const legacyTrackerKeyFor = (date = new Date()) =>
  `prayer_tracker_${date.toISOString().split("T")[0]}`;

/** Storage key for "the five-prayer celebration has already been shown today". */
export const celebrationKeyFor = (dayKey = localDayKey()) =>
  `five_prayer_celebration_${dayKey}`;
