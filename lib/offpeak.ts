// Traffic-aware scheduling for heavy background jobs.
//
// The site is busy through the IST day (~200 concurrent) and heaviest in the
// IST evening/night (~1000 students viewing classes). Heavy jobs — video
// encryption for offline, OCR/digest ingestion, duration sync — must NOT run
// during those hours or they compete with student page-loads for the same
// database and make the site slow (the "every second day" slowdowns).
//
// They run only in the genuinely quiet window, roughly 01:30–08:30 IST.
// Vercel cron fires in UTC; IST = UTC + 5:30, so that window is UTC 20:00–03:00.
export function isOffPeakNow(now: Date = new Date()): boolean {
  const h = now.getUTCHours();
  return h >= 20 || h < 3;
}
