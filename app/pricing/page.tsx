import Link from "next/link";
import { tryServiceClient } from "@/lib/supabase/service";
import { parseSlabs, slabTotal, slabMonthOptions, formatINR, type Slab } from "@/lib/pricing";
import { saleFromSettings } from "@/lib/sale";
import { summarizeSchedule } from "@/lib/schedule";

// PUBLIC pricing page — every plan and price, visible WITHOUT login, so a
// student can simply check "what does CA Final / CA Inter / the live batch
// cost" before creating an account. Linked from the footer's Explore column.
export const revalidate = 300;
export const metadata = {
  title: "Plans & Pricing — CA Parveen Sharma",
  description: "Transparent pricing for CA Final and CA Intermediate — Silver and Gold plans by duration, and live batches. All prices include GST.",
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default async function PricingPage() {
  const svc = tryServiceClient();
  if (!svc) return null;

  const [{ data: courses }, { data: subjects }, { data: silverPlan }, { data: settings }] = await Promise.all([
    svc.from("courses").select("id, title").eq("is_published", true).eq("is_test_series", false).order("order_index"),
    svc.from("subjects").select("id, title, course_id, validity_months, gold_price_inr, gold_slabs, silver_slabs, batch_months, batch_price_inr, included_with_subject_id").order("order_index"),
    svc.from("plans").select("web_price_inr").eq("tier", "silver").eq("is_active", true).maybeSingle(),
    svc.from("site_settings").select("key, value"),
  ]);
  const sale = saleFromSettings(new Map((settings ?? []).map((r) => [r.key, r.value as string | null])));
  const silverFlat = Number(silverPlan?.web_price_inr) || 0;

  type SubjRow = {
    id: string; title: string; course_id: string; validity_months: number | null;
    gold_price_inr: number | null; gold_slabs: unknown; silver_slabs: unknown;
    batch_months: number | null; batch_price_inr: number | null; included_with_subject_id: string | null;
  };
  const subs = (subjects ?? []) as SubjRow[];
  const titleById = new Map(subs.map((s) => [s.id, s.title]));

  // Live-batch schedules (dates shown on their price card).
  const batchSubs = subs.filter((s) => (Number(s.batch_months) || 0) > 0);
  const schedByBatch = new Map<string, ReturnType<typeof summarizeSchedule>>();
  for (const b of batchSubs) {
    const { data: rows } = await svc.from("class_schedule").select("scheduled_at").eq("subject_id", b.id);
    schedByBatch.set(b.id, summarizeSchedule((rows ?? []) as { scheduled_at: string }[]));
  }

  const courseList = (courses ?? []) as { id: string; title: string }[];

  return (
    <section className="section" style={{ maxWidth: 980, margin: "0 auto" }}>
      <div className="section-head">
        <span className="eyebrow">💰 Transparent pricing</span>
        <h1>Plans &amp; Pricing</h1>
        <p>Every price on one page — no login needed. All prices include GST.</p>
      </div>

      {sale && (
        <div style={{ background: "linear-gradient(90deg, var(--accent), var(--accent-2))", color: "#fff", borderRadius: 14, padding: "12px 18px", textAlign: "center", fontWeight: 700, marginBottom: 18 }}>
          🎉 {sale.headline} — {sale.discountPct}% OFF applies automatically at checkout
          {sale.endsAt ? ` · ends ${new Date(sale.endsAt).toLocaleDateString("en-IN")}` : ""}
        </div>
      )}

      {/* Quick jump */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center", marginBottom: 22 }}>
        {courseList.map((c) => (
          <a key={c.id} className="btn small secondary" href={`#${slug(c.title)}`}>Prices — {c.title}</a>
        ))}
        {batchSubs.length > 0 && <a className="btn small secondary" href={`#${slug(batchSubs[0].title)}`}>🔴 Live batch</a>}
      </div>

      {courseList.map((course) => {
        const courseSubs = subs.filter((s) => s.course_id === course.id);
        return (
          <div key={course.id} id={slug(course.title)} style={{ marginBottom: 34, scrollMarginTop: 90 }}>
            <h2 style={{ margin: "0 0 4px" }}>📘 {course.title}</h2>
            <p className="muted" style={{ margin: "0 0 14px", fontSize: ".88rem" }}>
              Bronze is free for everyone. Silver adds all tests &amp; AI doubt-solving. Gold unlocks the full premium classes.
            </p>
            <div style={{ display: "grid", gap: 14 }}>
              {courseSubs.map((s) => {
                const isBatch = (Number(s.batch_months) || 0) > 0;
                if (isBatch) {
                  const price = Number(s.batch_price_inr) || 0;
                  const sched = schedByBatch.get(s.id) ?? null;
                  const parent = s.included_with_subject_id ? titleById.get(s.included_with_subject_id) : "";
                  return (
                    <div key={s.id} id={slug(s.title)} className="card" style={{ border: "2px solid #dc2626", scrollMarginTop: 90 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                        <div>
                          <strong style={{ fontSize: "1.05rem" }}>
                            <span style={{ background: "#dc2626", color: "#fff", borderRadius: 8, padding: "1px 8px", fontSize: ".78rem", marginRight: 8, verticalAlign: "middle" }}>🔴 LIVE</span>
                            {s.title}
                          </strong>
                          {sched && (
                            <div className="muted" style={{ fontSize: ".84rem", marginTop: 4 }}>
                              🗓️ {sched.daysLabel} at {sched.timeLabel} IST · {sched.from} → {sched.to} · {sched.sessions} sessions
                            </div>
                          )}
                          <div className="muted" style={{ fontSize: ".84rem", marginTop: 2 }}>
                            One-time price · {s.batch_months} months access (live + recordings)
                            {parent ? ` · includes Silver access to full ${parent}` : ""}
                            {parent ? ` · FREE with ${parent} Gold` : ""}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: "1.5rem", fontWeight: 800 }}>{price > 0 ? formatINR(price) : "To be announced"}</div>
                          <Link className="btn small" href={`/courses/${s.id}`}>Explore →</Link>
                        </div>
                      </div>
                    </div>
                  );
                }

                const goldSlabs: Slab[] | null = parseSlabs(s.gold_slabs);
                const silverSlabs: Slab[] | null = parseSlabs(s.silver_slabs);
                const base = s.validity_months || 12;
                const months = goldSlabs ? slabMonthOptions(goldSlabs) : [1, 3, 6, 12, 24];
                const goldAt = (m: number) => goldSlabs ? slabTotal(goldSlabs, m) : s.gold_price_inr ? Math.max(1, Math.round((s.gold_price_inr * m) / base)) : 0;
                const silverAt = (m: number) => silverSlabs ? slabTotal(silverSlabs, m) : silverFlat ? Math.max(1, Math.round((silverFlat * m) / base)) : 0;
                const hasPrice = months.some((m) => goldAt(m) > 0 || silverAt(m) > 0);
                return (
                  <div key={s.id} className="card">
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                      <strong style={{ fontSize: "1.05rem" }}>{s.title}</strong>
                      <div style={{ display: "flex", gap: 8 }}>
                        <Link className="btn small secondary" href={`/courses/${s.id}`}>Explore →</Link>
                        <Link className="btn small" href={`/login?next=${encodeURIComponent(`/learn/${s.course_id}/plans?subject=${s.id}`)}`}>Enroll →</Link>
                      </div>
                    </div>
                    {hasPrice ? (
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".9rem" }}>
                          <thead>
                            <tr style={{ textAlign: "left", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>
                              <th style={{ padding: "6px 8px" }}>Validity</th>
                              <th style={{ padding: "6px 8px" }}>🥈 Silver</th>
                              <th style={{ padding: "6px 8px" }}>🥇 Gold (full classes)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {months.map((m) => (
                              <tr key={m} style={{ borderBottom: "1px solid var(--border)" }}>
                                <td style={{ padding: "6px 8px", fontWeight: 600 }}>{m} month{m === 1 ? "" : "s"}</td>
                                <td style={{ padding: "6px 8px" }}>{silverAt(m) > 0 ? formatINR(silverAt(m)) : "—"}</td>
                                <td style={{ padding: "6px 8px", fontWeight: 700 }}>{goldAt(m) > 0 ? formatINR(goldAt(m)) : "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p className="muted" style={{ fontSize: ".76rem", margin: "6px 0 0" }}>
                          Longer validity works out cheaper per month · custom durations available at enrolment · Bronze is free.
                        </p>
                      </div>
                    ) : (
                      <p className="muted" style={{ fontSize: ".88rem", margin: 0 }}>Pricing on request — contact us and we&apos;ll enrol you.</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <p className="muted" style={{ textAlign: "center", fontSize: ".85rem" }}>
        🔒 Secure checkout by Razorpay · all prices include GST · scholarships available —{" "}
        <Link href="/scholarship" style={{ fontWeight: 700, color: "var(--accent)" }}>apply here</Link>.
      </p>
    </section>
  );
}
