// Site-wide sale. Configured on /admin/sale and stored in site_settings.
// A sale is "live" only inside its start→end window (and when enabled). While
// live: banners show on the homepage & plans page, and the discount % comes off
// every subscription price automatically. It switches itself off after the end
// date — no need to remember to turn it off.

export type Sale = {
  discountPct: number;
  headline: string;
  bannerHome: string | null;
  bannerPlans: string | null;
  ctaUrl: string | null;
  endsAt: string | null;
};

export const SALE_KEYS = [
  "sale_enabled",
  "sale_start",
  "sale_end",
  "sale_discount_pct",
  "sale_headline",
  "sale_banner_home",
  "sale_banner_plans",
  "sale_cta_url",
] as const;

// Derive the live sale (if any) from a settings key→value map.
export function saleFromSettings(m: Map<string, string | null>): Sale | null {
  if ((m.get("sale_enabled") ?? "") !== "1") return null;

  const now = Date.now();
  const start = parseWhen(m.get("sale_start"));
  const end = parseWhen(m.get("sale_end"));
  if (start !== null && now < start) return null; // not started yet
  if (end !== null && now > end) return null;     // already ended

  const discountPct = clampPct(Number(m.get("sale_discount_pct")));
  const bannerHome = m.get("sale_banner_home") || null;
  const bannerPlans = m.get("sale_banner_plans") || null;
  // Nothing to show or give → treat as no sale.
  if (discountPct <= 0 && !bannerHome && !bannerPlans) return null;

  return {
    discountPct,
    headline: m.get("sale_headline") || "Limited-time offer",
    bannerHome,
    bannerPlans,
    ctaUrl: m.get("sale_cta_url") || null,
    endsAt: end !== null ? new Date(end).toISOString() : null,
  };
}

// Apply the sale discount to a rupee amount (returns a whole number ≥ 1).
export function applySaleDiscount(amount: number, sale: Sale | null): number {
  if (!sale || sale.discountPct <= 0) return amount;
  return Math.max(1, Math.round(amount * (1 - sale.discountPct / 100)));
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(90, Math.max(0, Math.round(n)));
}

// Accepts a <input type="datetime-local"> string or an ISO date. Returns epoch
// ms, or null if empty/unparseable. A bare datetime-local value ("2026-07-20T10:00",
// no timezone) is the admin's IST wall-clock time — pin it to +05:30 so it's
// read the same way regardless of the server's timezone (Vercel runs in UTC).
function parseWhen(v: string | null | undefined): number | null {
  if (!v) return null;
  const bareLocal = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v);
  const t = new Date(bareLocal ? `${v}:00+05:30` : v).getTime();
  return Number.isFinite(t) ? t : null;
}
