// "Today" for students is INDIAN today. The server runs in UTC, which is 5½
// hours behind IST — so between midnight and 05:30 IST a naive new Date()
// still reports yesterday (students log in from ~5 AM and saw yesterday's
// study target). Always derive the student-facing date in Asia/Kolkata.

export function todayIST(): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

export function todayISTParts(): { y: number; m: number; d: number } {
  const [y, m, d] = todayIST().split("-").map(Number);
  return { y, m, d };
}
