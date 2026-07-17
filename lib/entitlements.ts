import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

// The content/action categories the admin can cap per plan. Order = display
// order on the admin matrix + pricing page.
export const ACCESS_CATEGORIES: { key: string; label: string; kind: "content" | "action" }[] = [
  { key: "main_class", label: "🎥 Classes (main lectures)", kind: "content" },
  { key: "revision_class", label: "🎬 Revision videos", kind: "content" },
  { key: "question_bank", label: "📚 Question bank", kind: "content" },
  { key: "hand_notes", label: "✍️ Handwritten notes/book", kind: "content" },
  { key: "mtp", label: "📝 MTP (mock test papers)", kind: "content" },
  { key: "rtp", label: "📝 RTP (revision test papers)", kind: "content" },
  { key: "past_papers", label: "🗂️ Past exam papers", kind: "content" },
  { key: "case_study", label: "🧩 Case scenarios", kind: "content" },
  { key: "mcq_test", label: "🧠 MCQ tests", kind: "action" },
  { key: "descriptive_test", label: "✍️ Descriptive tests", kind: "action" },
  { key: "ask_query", label: "💬 Ask queries (AI doubts)", kind: "action" },
  { key: "build_plan", label: "🗓️ Build your plan", kind: "action" },
];

// Bronze retired (2026-07-17): the ladder is Free → Silver → Gold.
export const PLANS = ["free", "silver", "gold"] as const;
export type PlanTier = (typeof PLANS)[number];
// Legacy 'bronze' (was ₹0) maps to free.
const RANK: Record<string, number> = { free: 0, bronze: 0, silver: 1, gold: 2 };

// -1 = unlimited, 0 = none, N = cap.
export const UNLIMITED = -1;

let _cache: { at: number; map: Map<string, number> } | null = null;
export async function getAllLimits(): Promise<Map<string, number>> {
  if (_cache && Date.now() - _cache.at < 60_000) return _cache.map;
  const { data } = await createServiceClient().from("plan_limits").select("plan, category, lim");
  const map = new Map<string, number>();
  for (const r of data ?? []) map.set(`${r.plan}:${r.category}`, Number(r.lim));
  _cache = { at: Date.now(), map };
  return map;
}
export function clearLimitsCache() { _cache = null; }

export function limitFor(limits: Map<string, number>, plan: string, category: string): number {
  const v = limits.get(`${plan}:${category}`);
  return v === undefined ? UNLIMITED : v; // unset = unlimited (don't lock by accident)
}

// A student's effective plan = highest active paid tier they hold, else "free".
export async function studentPlan(userId: string): Promise<PlanTier> {
  const svc = createServiceClient();
  const { data } = await svc
    .from("subscriptions")
    .select("plans(tier)")
    .eq("student_id", userId)
    .eq("status", "active");
  let best: PlanTier = "free";
  for (const r of data ?? []) {
    const tier = ((r as { plans?: { tier?: string } | null }).plans?.tier ?? "").toLowerCase();
    if (RANK[tier] !== undefined && RANK[tier] > RANK[best]) best = tier as PlanTier;
  }
  return best;
}

export type QuotaResult = { allowed: boolean; limit: number; used: number; remaining: number; unlimited: boolean; plan: PlanTier };

// Check a student's remaining quota for a category (does NOT consume). refId lets
// content re-access (e.g. re-watching the already-counted class) stay allowed.
export async function checkQuota(userId: string, category: string, refId?: string): Promise<QuotaResult> {
  const [limits, plan] = await Promise.all([getAllLimits(), studentPlan(userId)]);
  const lim = limitFor(limits, plan, category);
  if (lim === UNLIMITED) return { allowed: true, limit: -1, used: 0, remaining: -1, unlimited: true, plan };

  const svc = createServiceClient();
  const { data: u } = await svc.from("plan_usage").select("used, ref_ids").eq("user_id", userId).eq("category", category).maybeSingle();
  const used = Number(u?.used ?? 0);
  const refIds = (u?.ref_ids as string[] | null) ?? [];
  if (refId && refIds.includes(refId)) return { allowed: true, limit: lim, used, remaining: Math.max(0, lim - used), unlimited: false, plan };
  return { allowed: used < lim, limit: lim, used, remaining: Math.max(0, lim - used), unlimited: false, plan };
}

// Consume one unit (after a successful action / first access to a piece of
// content). No-op when unlimited or when this refId was already counted.
export async function consumeQuota(userId: string, category: string, refId?: string): Promise<void> {
  const [limits, plan] = await Promise.all([getAllLimits(), studentPlan(userId)]);
  if (limitFor(limits, plan, category) === UNLIMITED) return;
  const svc = createServiceClient();
  const { data: u } = await svc.from("plan_usage").select("used, ref_ids").eq("user_id", userId).eq("category", category).maybeSingle();
  const refIds = (u?.ref_ids as string[] | null) ?? [];
  if (refId && refIds.includes(refId)) return; // already counted
  await svc.from("plan_usage").upsert({
    user_id: userId,
    category,
    used: Number(u?.used ?? 0) + 1,
    ref_ids: refId ? [...refIds, refId] : refIds,
  }, { onConflict: "user_id,category" });
}
