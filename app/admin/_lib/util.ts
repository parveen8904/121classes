// Shared helpers for the admin content manager.

// URL-friendly slug from a title. "AS 24 – Discontinuing Ops" -> "as-24-discontinuing-ops"
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Coerce a form text value to a trimmed string ("" stays "").
export function str(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}

// Coerce to a number with a fallback (used for order_index etc.).
export function num(v: FormDataEntryValue | null, fallback = 0): number {
  const n = Number(v ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

// Empty string -> null (so optional columns store NULL, not "").
export function nullable(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

// Minutes -> "1h 30m" / "45m" / "2h" (used for class/topic/subject durations).
export function fmtMins(mins: number): string {
  const m = Math.max(0, Math.round(mins || 0));
  if (!m) return "0m";
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
}

/**
 * A price as a person types it.
 *
 * `num()` hands anything non-numeric back as 0, and the price fields then store
 * `|| null` — so "5,000" or "₹5000" or "5000/-" saved as NO PRICE AT ALL, with
 * the field simply blank on the next load and no error anywhere. He set the
 * Financial Instruments fee and the site kept showing nothing; this is why.
 *
 * Returns null only when there is genuinely no number in what was typed.
 */
export function money(v: FormDataEntryValue | null): number | null {
  const raw = String(v ?? "").replace(/[₹,\s]/g, "").replace(/\/-$/, "");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}
