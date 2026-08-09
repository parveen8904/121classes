import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { formatINR } from "@/lib/pricing";
import AdminHero from "../../_components/AdminHero";

export const dynamic = "force-dynamic";
export const metadata = { title: "Subscribers — Admin" };

const TIER_LABEL: Record<string, string> = { gold: "🥇 Gold", silver: "🥈 Silver", bronze: "🥉 Bronze", all: "All active" };

type Row = {
  status: string; starts_at: string | null; ends_at: string | null; channel: string | null; created_at: string;
  plans: { tier: string; name: string } | null;
  subjects: { title: string } | null;
  profiles: {
    id: string; full_name: string | null; email: string | null; phone: string | null;
    address_line1: string | null; address_line2: string | null; city: string | null; state: string | null; pincode: string | null;
  } | null;
};

const fmt = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

export default async function SubscribersPage(props: { searchParams: Promise<{ tier?: string }> }) {
  const sp = await props.searchParams;
  const tier = ["gold", "silver", "bronze"].includes(sp.tier ?? "") ? sp.tier! : "all";

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: prof } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle()
    : { data: null };
  if (prof?.role !== "admin") {
    return <section className="container" style={{ paddingTop: 40 }}><p>Admins only.</p></section>;
  }

  const svc = createServiceClient();
  // Every active subscription, not the first thousand. PostgREST stops at 1,000
  // rows without a word, and there are more than 1,500 — so this report was
  // quietly leaving out around six hundred of the very people it exists to
  // list.
  const data: unknown[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: page, error } = await svc
      .from("subscriptions")
      .select("status, starts_at, ends_at, channel, created_at, plans(tier, name), subjects:subject_id(title), profiles:student_id(id, full_name, email, phone, address_line1, address_line2, city, state, pincode)")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .range(from, from + 999);
    if (error) break;
    data.push(...(page ?? []));
    if ((page ?? []).length < 1000) break;
  }

  const now = new Date();
  let rows = ((data ?? []) as unknown as Row[]).filter((r) => !r.ends_at || new Date(r.ends_at) > now);
  if (tier !== "all") rows = rows.filter((r) => r.plans?.tier === tier);

  // What each subscriber actually paid on the website + their level.
  const ids = [...new Set(rows.map((r) => r.profiles?.id).filter(Boolean))] as string[];
  const paidByUser = new Map<string, number>();
  const levelByUser = new Map<string, string>();
  if (ids.length) {
    // Asked in batches. A single .in() carrying a thousand UUIDs is about
    // thirty-seven thousand characters of URL — the server refuses it, the
    // query comes back empty, and EVERY amount on the report renders as zero.
    // Which is exactly what happened: two students who had genuinely paid
    // ₹9,897 and ₹1,900 appeared to have paid nothing.
    const inBatches = async <T,>(build: (batch: string[]) => PromiseLike<{ data: T[] | null }>) => {
      const out: T[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const { data: part } = await build(ids.slice(i, i + 200));
        out.push(...(part ?? []));
      }
      return out;
    };
    const [ord, mc] = await Promise.all([
      inBatches<{ student_id: string; amount_inr: number }>((b) =>
        svc.from("orders").select("student_id, amount_inr").eq("status", "paid").in("student_id", b)),
      inBatches<{ student_id: string; courses?: { title?: string } | null }>(async (b) => {
        // The join comes back typed as an array; the report reads one title.
        const { data: d } = await svc.from("my_courses").select("student_id, courses(title)").in("student_id", b);
        return { data: (d ?? []) as unknown as { student_id: string; courses?: { title?: string } | null }[] };
      }),
    ]);
    for (const o of ord ?? []) {
      paidByUser.set(o.student_id as string, (paidByUser.get(o.student_id as string) ?? 0) + (o.amount_inr ?? 0));
    }
    for (const r of mc ?? []) {
      const t = ((r as { courses?: { title?: string } | null }).courses?.title ?? "").toLowerCase();
      const lvl = t.includes("final") ? "Final" : t.includes("inter") ? "Inter" : "";
      if (!lvl) continue;
      const cur = levelByUser.get(r.student_id as string);
      levelByUser.set(r.student_id as string, cur && cur !== lvl ? "Final + Inter" : lvl);
    }
  }

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="🎓 Subscribers"
        title={`${TIER_LABEL[tier]} subscribers — ${rows.length}`}
        subtitle="Every active subscription with full contact details. 📋"
        back={{ href: "/admin/reports", label: "Reports" }}
      />

      <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(["all", "gold", "silver", "bronze"] as const).map((t) => (
          <a key={t} className={`btn small ${t === tier ? "" : "secondary"}`} href={`/admin/reports/subscribers?tier=${t}`}>
            {TIER_LABEL[t]}
          </a>
        ))}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        {rows.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No active {tier === "all" ? "" : tier + " "}subscribers right now.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".84rem" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
                  <th style={{ padding: "6px 8px" }}>Name</th>
                  <th style={{ padding: "6px 8px" }}>Level</th>
                  <th style={{ padding: "6px 8px" }}>Subject · plan</th>
                  <th style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>Start</th>
                  <th style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>End</th>
                  <th style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>Amount paid</th>
                  <th style={{ padding: "6px 8px" }}>Phone</th>
                  <th style={{ padding: "6px 8px" }}>Email</th>
                  <th style={{ padding: "6px 8px" }}>Address</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const p = r.profiles;
                  const address = p
                    ? [p.address_line1, p.address_line2, [p.city, p.state, p.pincode].filter(Boolean).join(" ")].filter(Boolean).join(", ")
                    : "";
                  const paid = p ? paidByUser.get(p.id) ?? 0 : 0;
                  return (
                    <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "6px 8px", fontWeight: 600 }}>{p?.full_name ?? "—"}</td>
                      <td style={{ padding: "6px 8px" }}>{p ? levelByUser.get(p.id) ?? "—" : "—"}</td>
                      <td style={{ padding: "6px 8px" }}>
                        {r.subjects?.title ?? "—"}
                        <span className="muted"> · {r.plans?.name ?? r.plans?.tier ?? ""}</span>
                      </td>
                      <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{fmt(r.starts_at ?? r.created_at)}</td>
                      <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{fmt(r.ends_at)}</td>
                      <td style={{ padding: "6px 8px", fontWeight: 700, whiteSpace: "nowrap" }}>
                        {r.channel === "admin_grant" ? <span className="muted">free (admin grant)</span> : formatINR(paid)}
                      </td>
                      <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{p?.phone ?? "—"}</td>
                      <td style={{ padding: "6px 8px" }}>{p?.email ?? "—"}</td>
                      <td style={{ padding: "6px 8px" }}>{address || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="muted" style={{ fontSize: ".78rem", marginTop: 8 }}>
        &ldquo;Amount paid&rdquo; is the total that student has paid on the website across all their purchases.
        Admin-granted subscriptions show as free.
      </p>
    </section>
  );
}
