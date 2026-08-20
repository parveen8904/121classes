// THE SECURITY SELF-CHECK.
//
// It does exactly what an outsider would do: takes the PUBLIC anon key (the one
// that ships in the browser) and, from the server, asks the live REST API for
// the things that must never be handed to a stranger — the asset register,
// student personal data, the reporting functions. A row coming back is a leak;
// an empty answer or a "permission denied" is the wall doing its job.
//
// This is the same probe that found the asset-register hole on 20 Aug. Run it
// whenever you add a table or a function, and nothing can quietly go public
// again without a red line appearing here.

const URL_BASE = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export type Verdict = "locked" | "leak" | "na";
export type ProbeResult = {
  kind: "table" | "rpc";
  name: string;
  what: string;      // plain-English of what it holds
  verdict: Verdict;
  detail: string;    // what the anon key actually got back
};

// Tables that hold private data — anon must get nothing.
const SENSITIVE_TABLES: { name: string; what: string }[] = [
  { name: "assets", what: "Your asset register (values, addresses)" },
  { name: "asset_owners", what: "Who owns each asset" },
  { name: "asset_txns", what: "Asset money in/out" },
  { name: "asset_tenancy", what: "Tenants & rent agreements" },
  { name: "asset_letters", what: "Asset legal letters" },
  { name: "profiles", what: "Student names, emails, phones" },
  { name: "subscriptions", what: "Who has paid for what" },
  { name: "orders", what: "Order & payment records" },
  { name: "book_orders", what: "Book order records" },
  { name: "doubts", what: "Student doubts" },
  { name: "push_outbox", what: "Every student's notifications" },
  { name: "leads", what: "Sales leads (names, phones)" },
  { name: "tickets", what: "Support tickets" },
  { name: "career_profiles", what: "Student placement profiles" },
  { name: "device_sessions", what: "Login device sessions" },
  { name: "study_plans", what: "Student study plans" },
  { name: "cost_history", what: "Your cost/billing ledger" },
];

// Functions that must be denied to anon (they return private data or run work).
const SENSITIVE_RPCS: { name: string; what: string; body: string }[] = [
  { name: "mentoring_queue", what: "Student names, phones, ADDRESSES", body: '{"days_since_touch":1}' },
  { name: "doubt_report_summary", what: "Doubt counts", body: '{"p_days":1}' },
  { name: "paper_report_days", what: "Internal ops figures", body: '{"days":1}' },
  { name: "lead_sources", what: "Your lead sources", body: "{}" },
  { name: "ai_spend_since", what: "Your AI spend", body: '{"period_start":"2026-01-01T00:00:00Z"}' },
  { name: "search_repository", what: "Paid study material", body: '{"p_query":"a","p_limit":1}' },
  { name: "my_notifications", what: "Any user's notifications", body: '{"p_user":"00000000-0000-0000-0000-000000000000","p_limit":1}' },
  { name: "get_protected_class_key", what: "Class DRM keys", body: '{"p_id":"00000000-0000-0000-0000-000000000000"}' },
  { name: "list_downloadable_classes", what: "Downloadable class list", body: "{}" },
];

async function probe(url: string, body: string | null): Promise<{ status: number; text: string }> {
  try {
    const res = await fetch(url, {
      method: body == null ? "GET" : "POST",
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "content-type": "application/json" },
      body: body ?? undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    return { status: res.status, text: (await res.text()).slice(0, 400) };
  } catch (e) {
    return { status: 0, text: e instanceof Error ? e.message : "network error" };
  }
}

function classifyTable(status: number, text: string): { verdict: Verdict; detail: string } {
  if (/"code":"42501"/.test(text) || status === 401 || status === 403) return { verdict: "locked", detail: "permission denied ✅" };
  if (/"code":"42P01"/.test(text) || status === 404) return { verdict: "na", detail: "table not found" };
  if (status === 200) {
    const rows = safeArray(text);
    if (rows == null) return { verdict: "na", detail: "unexpected response" };
    if (rows.length > 0) return { verdict: "leak", detail: `RETURNED ${rows.length} row — readable by anyone` };
    return { verdict: "locked", detail: "empty — row security holding ✅" };
  }
  return { verdict: "na", detail: `HTTP ${status}` };
}

function classifyRpc(status: number, text: string): { verdict: Verdict; detail: string } {
  if (/"code":"42501"/.test(text) || status === 401 || status === 403) return { verdict: "locked", detail: "permission denied ✅" };
  if (/PGRST202/.test(text) || status === 404) return { verdict: "na", detail: "not callable / signature differs" };
  if (status === 200) {
    const v = text.trim();
    if (v === "" || v === "null" || v === "[]" || v === "0") return { verdict: "locked", detail: "empty result ✅" };
    return { verdict: "leak", detail: "RETURNED DATA — callable by anyone" };
  }
  return { verdict: "na", detail: `HTTP ${status}` };
}

function safeArray(text: string): unknown[] | null {
  try { const j = JSON.parse(text); return Array.isArray(j) ? j : null; } catch { return null; }
}

export async function runSecurityProbes(): Promise<ProbeResult[]> {
  if (!URL_BASE || !ANON) return [];
  const out: ProbeResult[] = [];

  await Promise.all(SENSITIVE_TABLES.map(async (t) => {
    const { status, text } = await probe(`${URL_BASE}/rest/v1/${t.name}?select=*&limit=1`, null);
    const { verdict, detail } = classifyTable(status, text);
    out.push({ kind: "table", name: t.name, what: t.what, verdict, detail });
  }));

  await Promise.all(SENSITIVE_RPCS.map(async (r) => {
    const { status, text } = await probe(`${URL_BASE}/rest/v1/rpc/${r.name}`, r.body);
    const { verdict, detail } = classifyRpc(status, text);
    out.push({ kind: "rpc", name: r.name, what: r.what, verdict, detail });
  }));

  // Leaks first, then n/a, then locked — worst at the top.
  const order: Record<Verdict, number> = { leak: 0, na: 1, locked: 2 };
  return out.sort((a, b) => order[a.verdict] - order[b.verdict] || a.name.localeCompare(b.name));
}
