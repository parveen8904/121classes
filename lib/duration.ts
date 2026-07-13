// Class durations are shown assuming the recommended 1.25× playback speed, so
// the time students see is the ACTUAL time it takes them to watch (shorter than
// the raw recording). Always paired with a visible "at 1.25× speed" note so it
// is honest, never a hidden claim.
export const WATCH_SPEED = 1.25;
export const SPEED_NOTE = "⚡ Best viewed at 1.25× speed — we strongly recommend watching classes at 1.25×.";

// Actual recorded minutes → minutes at 1.25×.
export function at125(actualMins: number): number {
  return Math.max(0, Math.round((actualMins || 0) / WATCH_SPEED));
}

// Format actual recorded minutes as an "at 1.25×" duration string ("3h 20m").
export function fmtMins(actualMins: number): string {
  const m = at125(actualMins);
  if (!m) return "";
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
}
