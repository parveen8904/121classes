import { createServiceClient } from "@/lib/supabase/service";
import { currentStaff, type Staff } from "@/lib/adminAccess";

// THE FOUNDER'S ASSET REGISTER — the shared brain of /admin/assets.
//
// Agreed on 20 August 2026, discussed before a line was written. ~20-30 assets,
// 2-5 people handling them. The rules that shape everything here:
//
//   · WHO SEES WHAT is decided by role, in code, on every page and action:
//     - the founder (role=admin) sees everything;
//     - a HANDLER (permission "assets") sees only assets assigned to them,
//       and never ownership, valuations or returns;
//     - ACCOUNTS (permission "assets_accounts") sees and verifies transactions
//       and the pendency report, and never ownership/valuations either.
//   · A task's completion IS the transaction — one form, one record.
//   · Every transaction lands unverified; accounts ticks it after checking
//     date, amount, GST/TDS. Maker-checker, same as the vendor desk.
//   · Returns are shown two ways, side by side: what the contract promised,
//     and what the cash flows actually did (XIRR). Only the founder sees them.

export const BUCKET = "assets";

export const ASSET_TYPES = [
  "property", "fixed deposit", "bonds", "mutual fund", "shares", "gold",
  "loan given", "other",
] as const;

export const TXN_NATURES_IN = [
  "Rent received", "Interest received", "Dividend received", "Maturity proceeds",
  "Sale proceeds", "Loan repayment received", "Other income",
] as const;

export const TXN_NATURES_OUT = [
  "House tax paid", "Society charges", "Repair & maintenance", "Insurance paid",
  "Brokerage / legal fees", "Further investment", "Other expense",
] as const;

export type Viewer = { staff: Staff; role: "admin" | "accounts" | "handler" };

/** Resolve what the signed-in staff member may do on the assets desk. */
export async function assetViewer(): Promise<Viewer | null> {
  const staff = await currentStaff();
  if (!staff) return null;
  if (staff.role === "admin") return { staff, role: "admin" };
  if (staff.role !== "operator" && staff.role !== "faculty") return null;
  // Accounts outranks handler when somebody holds both grants.
  if (staff.permissions.includes("assets_accounts")) return { staff, role: "accounts" };
  if (staff.permissions.includes("assets")) return { staff, role: "handler" };
  return null;
}

/** Asset ids a handler may see. Admin/accounts pass null = all. */
export async function handledAssetIds(userId: string): Promise<string[]> {
  const { data } = await createServiceClient()
    .from("asset_handlers").select("asset_id").eq("user_id", userId);
  return (data ?? []).map((r) => String(r.asset_id));
}

/** One-hour signed URL into the private bucket; null for a missing path. */
export async function signAssetPath(path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const { data } = await createServiceClient().storage.from(BUCKET).createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

export const inr = (n: number | null | undefined): string =>
  n == null ? "—" : "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });

export const IST = "Asia/Kolkata";
export const istToday = (): string => new Date().toLocaleDateString("en-CA", { timeZone: IST });

export const dmy = (d: string | null | undefined): string =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: IST }) : "—";

// ── XIRR ─────────────────────────────────────────────────────────────────────
//
// The honest return: the rate that discounts the actual dated cash flows to
// zero. Money out (the investment, taxes, repairs) is negative; money in
// (rent, interest, sale) positive. Newton-Raphson from a sane guess, bisection
// when Newton wanders — the classic pairing, because Newton alone diverges on
// lumpy real-estate flows.
export type CashFlow = { on: string; amount: number };

export function xirr(flows: CashFlow[]): number | null {
  const fs = flows
    .filter((f) => f.amount !== 0 && f.on)
    .map((f) => ({ t: new Date(f.on).getTime(), amount: f.amount }))
    .sort((a, b) => a.t - b.t);
  if (fs.length < 2) return null;
  const hasNeg = fs.some((f) => f.amount < 0), hasPos = fs.some((f) => f.amount > 0);
  if (!hasNeg || !hasPos) return null;

  const t0 = fs[0].t;
  const years = (t: number) => (t - t0) / (365.25 * 86400_000);
  const npv = (r: number) => fs.reduce((s, f) => s + f.amount / Math.pow(1 + r, years(f.t)), 0);

  // Newton first.
  let r = 0.1;
  for (let i = 0; i < 50; i++) {
    const v = npv(r);
    if (Math.abs(v) < 1e-7) return r;
    const dv = (npv(r + 1e-6) - v) / 1e-6;
    if (!Number.isFinite(dv) || dv === 0) break;
    const next = r - v / dv;
    if (!Number.isFinite(next) || next <= -0.999) break;
    if (Math.abs(next - r) < 1e-9) return next;
    r = next;
  }
  // Bisection fallback over a wide bracket.
  let lo = -0.99, hi = 10;
  let flo = npv(lo), fhi = npv(hi);
  if (flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-7) return mid;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

type AssetRow = {
  invested_on: string | null; invested_amount: number | null;
  status: string; closed_on: string | null; sale_amount: number | null;
  current_value: number | null; current_value_on: string | null;
};
type TxnRow = { on_date: string; direction: string; amount: number };

/**
 * The asset's actual annual return from its recorded life.
 * Open assets need a current value to anchor the far end; without one the
 * number would be a lie, so we return null and the page says why.
 */
export function assetXirr(a: AssetRow, txns: TxnRow[]): { rate: number | null; why?: string } {
  const flows: CashFlow[] = [];
  if (a.invested_on && a.invested_amount) flows.push({ on: a.invested_on, amount: -Number(a.invested_amount) });
  for (const t of txns) flows.push({ on: t.on_date, amount: (t.direction === "out" ? -1 : 1) * Number(t.amount) });
  if (a.status === "closed") {
    if (a.closed_on && a.sale_amount) flows.push({ on: a.closed_on, amount: Number(a.sale_amount) });
  } else if (a.current_value) {
    flows.push({ on: a.current_value_on || istToday(), amount: Number(a.current_value) });
  } else {
    return { rate: null, why: "Set a current value to compute the actual return of an open asset." };
  }
  const r = xirr(flows);
  return r == null ? { rate: null, why: "Not enough dated cash flows yet." } : { rate: r };
}

// ── Occurrence generation (called by the nightly cron) ──────────────────────
//
// Tasks are standing orders; occurrences are the dated copies people actually
// do. Generated a month or so ahead — enough for reminders, not so far that a
// cancelled tenancy litters the future.
const HORIZON_DAYS = 40;

function clampDay(year: number, monthIdx: number, day: number): string {
  const last = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
  const d = Math.min(Math.max(1, day), last);
  return `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export async function generateOccurrences(): Promise<number> {
  const svc = createServiceClient();
  const today = istToday();
  const horizon = new Date(Date.now() + HORIZON_DAYS * 86400_000).toISOString().slice(0, 10);

  const { data: tasks } = await svc
    .from("asset_tasks")
    .select("id, asset_id, cadence, due_day, anchor_date, created_at, active, assets!inner(status)")
    .eq("active", true);

  let made = 0;
  for (const t of tasks ?? []) {
    if ((t.assets as { status?: string } | null)?.status === "closed") continue;
    const startedOn = String(t.created_at).slice(0, 10);
    const wanted: string[] = [];

    if (t.cadence === "monthly" && t.due_day) {
      const now = new Date();
      for (const shift of [0, 1, 2]) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + shift, 1));
        wanted.push(clampDay(d.getUTCFullYear(), d.getUTCMonth(), Number(t.due_day)));
      }
    } else if (t.cadence === "annual" && t.anchor_date) {
      const anchor = new Date(t.anchor_date);
      const y = new Date().getUTCFullYear();
      for (const year of [y, y + 1]) {
        wanted.push(clampDay(year, anchor.getUTCMonth(), anchor.getUTCDate()));
      }
    } else if (t.cadence === "once" && t.anchor_date) {
      wanted.push(String(t.anchor_date));
    }

    for (const due of wanted) {
      // Within the window, and never before the task existed — a rent task
      // added in August must not invent July's rent as instantly overdue.
      if (due > horizon) continue;
      if (due < startedOn && due < today) continue;
      const { error } = await svc.from("asset_occurrences").insert({ task_id: t.id, asset_id: t.asset_id, due_on: due });
      if (!error) made++;
      // unique(task_id, due_on) makes re-runs harmless.
    }
  }
  return made;
}

/** Staff who can be assigned work: admins, operators, faculty. */
export async function assignableStaff(): Promise<{ id: string; name: string }[]> {
  const { data } = await createServiceClient()
    .from("profiles").select("id, full_name, email, role")
    .in("role", ["admin", "operator", "faculty"])
    .order("full_name");
  return (data ?? []).map((p) => ({ id: String(p.id), name: String(p.full_name || p.email || "staff") }));
}
