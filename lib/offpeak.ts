// Traffic-aware scheduling for heavy background jobs.
//
// The site is busy through the IST day (~200 concurrent) and heaviest in the
// IST evening/night (~1000 students viewing classes). Heavy jobs — video
// encryption for offline, OCR/digest ingestion, duration sync — must NOT run
// during those hours or they compete with student page-loads for the same
// database and make the site slow (the "every second day" slowdowns).
//
// Students start logging in as early as 5:00–6:30 AM IST, and night viewing runs
// late, so the only genuinely quiet window is ~01:30–04:30 IST. Heavy jobs must
// finish before the early-morning students arrive.
// Vercel cron fires in UTC; IST = UTC + 5:30, so 01:30–04:30 IST = UTC 20:00–23:00.
export function isOffPeakNow(now: Date = new Date()): boolean {
  const h = now.getUTCHours();
  return h >= 20 && h < 23;
}
