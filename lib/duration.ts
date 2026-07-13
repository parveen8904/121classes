// Class durations. Individual class times are shown NORMAL (the true recorded
// length). Only the aggregate "total hours" figure is shown reduced to 1.25×
// watch speed, with a visible "(best viewed at 1.25×)" note so it's honest.
export const WATCH_SPEED = 1.25;
export const AT125_NOTE = "(best viewed at 1.25×)";

function fmt(m: number): string {
  const mm = Math.max(0, Math.round(m || 0));
  if (!mm) return "";
  const h = Math.floor(mm / 60);
  const r = mm % 60;
  return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
}

// Normal (actual) minutes — for a single class / topic listing.
export function fmtMins(actualMins: number): string {
  return fmt(actualMins);
}

// Reduced to 1.25× — for the TOTAL-hours figure only.
export function fmtAt125(actualMins: number): string {
  return fmt((actualMins || 0) / WATCH_SPEED);
}
