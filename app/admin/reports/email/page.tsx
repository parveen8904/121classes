import { getSecret } from "@/lib/secrets";
import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../../_components/AdminHero";
import { assertArea } from "@/lib/adminAccess";

export const dynamic = "force-dynamic";
export const metadata = { title: "Email report — Admin" };

// Did the email actually arrive?
//
// The site sends a great deal of mail — verification, reset, granted access,
// invoices, the answer to a doubt — and until now the only way to know whether
// any of it landed was to log into Mailgun. Worse, "we sent it" and "it arrived"
// are different claims, and it was the first that was being reported.
//
// So this reads Mailgun's OWN counts. Delivered means a mail server accepted it.
// Failed means it did not arrive and the student never saw it — which is the
// number worth acting on, because those students are sitting there waiting.

type Stat = { delivered: number; failed: number; accepted: number; opened: number };

async function mailgunStats(days: number): Promise<{ stat: Stat | null; error: string | null }> {
  const apiKey = await getSecret("MAILGUN_API_KEY");
  const domain = await getSecret("MAILGUN_DOMAIN");
  if (!apiKey || !domain) return { stat: null, error: "Mailgun is not configured — add the key in Integrations." };

  const region = (await getSecret("MAILGUN_REGION")).toLowerCase();
  const base = region === "eu" ? "https://api.eu.mailgun.net" : "https://api.mailgun.net";
  const qs = new URLSearchParams({ duration: `${days}d`, resolution: "day" });
  for (const e of ["accepted", "delivered", "failed", "opened"]) qs.append("event", e);

  try {
    const res = await fetch(`${base}/v3/${domain}/stats/total?${qs.toString()}`, {
      headers: { Authorization: "Basic " + Buffer.from(`api:${apiKey}`).toString("base64") },
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        stat: null,
        error:
          res.status === 401
            ? "Mailgun refused the key. The stored key may be a sending key without reporting rights."
            : `Mailgun returned ${res.status}.`,
      };
    }
    // Mailgun nests one level deeper for failures than for the rest:
    // accepted.total, but failed.permanent.total and failed.temporary.total.
    // Reading `failed.permanent` as a number yields NaN, not a count.
    type Bucket = { total?: number; permanent?: { total?: number }; temporary?: { total?: number } };
    const json = (await res.json()) as { stats?: Record<string, Bucket>[] };
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

    const total: Stat = { delivered: 0, failed: 0, accepted: 0, opened: 0 };
    for (const row of json.stats ?? []) {
      total.accepted += n(row.accepted?.total);
      total.delivered += n(row.delivered?.total);
      total.opened += n(row.opened?.total);
      total.failed += n(row.failed?.permanent?.total) + n(row.failed?.temporary?.total);
    }
    return { stat: total, error: null };
  } catch (e) {
    return { stat: null, error: e instanceof Error ? e.message : "Could not reach Mailgun." };
  }
}

export default async function EmailReportPage(props: { searchParams: Promise<{ days?: string }> }) {
  await assertArea(null);
  const { days } = await props.searchParams;
  const windowDays = Math.min(30, Math.max(1, Number(days) || 7));

  const svc = createServiceClient();
  const since = new Date(Date.now() - windowDays * 86400_000).toISOString();

  const [{ stat, error }, { data: ours }] = await Promise.all([
    mailgunStats(windowDays),
    svc
      .from("notifications")
      .select("template, status, channel, sent_at")
      .eq("channel", "email")
      .gte("sent_at", since)
      .limit(5000),
  ]);

  // What the site asked to send, by the kind of message — so a template that is
  // silently failing stands out from one nobody triggers.
  const byTemplate = new Map<string, { sent: number; skipped: number }>();
  for (const n of ours ?? []) {
    const key = (n.template as string) || "other";
    if (!byTemplate.has(key)) byTemplate.set(key, { sent: 0, skipped: 0 });
    const row = byTemplate.get(key)!;
    if (n.status === "sent") row.sent += 1;
    else row.skipped += 1;
  }
  const templates = [...byTemplate.entries()].sort((a, b) => b[1].sent + b[1].skipped - (a[1].sent + a[1].skipped));

  const deliveredPct = stat && stat.accepted > 0 ? Math.round((stat.delivered / stat.accepted) * 100) : null;

  // Open tracking is switched off on the sending domain, so a zero here means
  // "not measured", not "nobody read it" — and reporting it as 0 would be a lie
  // about how our email is doing.
  const opensTracked = Boolean(stat && stat.opened > 0);

  const kpis = [
    { icon: "📤", label: "Handed to Mailgun", value: stat ? String(stat.accepted) : "—" },
    { icon: "✅", label: "Delivered", value: stat ? String(stat.delivered) : "—" },
    { icon: "🚫", label: "Failed to arrive", value: stat ? String(stat.failed) : "—" },
    {
      icon: "👀",
      label: opensTracked ? "Opened" : "Opens not tracked",
      value: opensTracked ? String(stat!.opened) : "—",
    },
  ];

  return (
    <section className="container" style={{ paddingTop: 24, paddingBottom: 60, maxWidth: 900 }}>
      <AdminHero
        badge="✉️ Email report"
        title="Did the email actually arrive?"
        subtitle="Mailgun's own counts, not ours. Delivered means a mail server accepted it; failed means the student never saw it."
        back={{ href: "/admin/reports", label: "Reports" }}
      />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "16px 0" }}>
        {[1, 7, 30].map((d) => (
          <a key={d} className={`btn small ${windowDays === d ? "" : "secondary"}`} href={`/admin/reports/email?days=${d}`}>
            {d === 1 ? "Today" : `${d} days`}
          </a>
        ))}
      </div>

      {error && <div className="notice err" style={{ marginBottom: 16 }}>⚠️ {error}</div>}

      <div className="admin-cards" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
        {kpis.map((k) => (
          <div className="admin-tile" key={k.label}>
            <div className="tile-ic">{k.icon}</div>
            <h3 style={{ fontSize: "1.5rem" }}>{k.value}</h3>
            <p>{k.label}</p>
          </div>
        ))}
      </div>

      {deliveredPct !== null && (
        <div className="card" style={{ marginTop: 16 }}>
          <strong style={{ fontSize: "1.1rem" }}>{deliveredPct}% of our email is arriving.</strong>
          <p className="muted" style={{ margin: "6px 0 0", fontSize: ".9rem" }}>
            {deliveredPct >= 97
              ? "That is healthy. Nothing to do."
              : deliveredPct >= 90
                ? "A little low. Usually a handful of dead addresses — worth a look at the failures in Mailgun."
                : "Too low. Students are not getting mail they are waiting for. Check the failures in Mailgun before sending anything else in bulk."}
          </p>
        </div>
      )}

      <h2 className="admin-section-title">📋 What the site sent, by kind of message</h2>
      <p className="muted" style={{ fontSize: ".85rem", marginTop: -6 }}>
        Our own record of what was triggered. A kind with many &ldquo;not sent&rdquo; is a fault worth chasing — the
        student was owed that message.
      </p>
      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {templates.length === 0 ? (
          <div className="card"><p className="muted" style={{ margin: 0 }}>Nothing sent in this period.</p></div>
        ) : (
          templates.map(([name, c]) => (
            <div className="list-row" key={name}>
              <span className="row-title">✉️ {name.replace(/_/g, " ")}</span>
              <span>
                <strong>{c.sent}</strong> sent
                {c.skipped > 0 && (
                  <span style={{ color: "#b45309", fontWeight: 700, marginLeft: 10 }}>{c.skipped} not sent</span>
                )}
              </span>
            </div>
          ))
        )}
      </div>

      <p className="muted" style={{ fontSize: ".82rem", marginTop: 24 }}>
        Student mail written to us arrives separately and is answered automatically — see the{" "}
        <a href="/admin/doubt-log">doubt report</a>.
      </p>
    </section>
  );
}
