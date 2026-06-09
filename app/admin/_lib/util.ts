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
