import AdminHero from "../_components/AdminHero";
import { EMAIL_CATALOGUE } from "@/lib/emailCatalogue";
import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";
import SubmitButton from "@/app/components/SubmitButton";
import { EMAIL_EVENTS, GENERATED_EMAILS, loadTemplate, renderTemplate, type EmailEventDef } from "@/lib/emailTemplates";
import { saveEmailTemplate, restoreEmailDefault, sendTestEmail } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Emails — Admin" };

// One page for the wording of every email the site sends. Each event shows the
// text as it stands, what it will look like when it arrives, and the details
// that get filled in. Nothing here is in Mailgun — Mailgun only carries the
// message; the words are ours.

const GROUPS = ["Account & login", "Access", "Offers", "Support", "Classes"] as const;

// Did the email actually arrive? Mailgun's OWN counts — "we sent it" and "it
// arrived" are different claims, and only the second one matters to a student
// sitting there waiting. This lived at /admin/reports/email until 19 August;
// merged here because two email tiles meant nobody knew which one to open.
type DeliveryStat = { delivered: number; failed: number; accepted: number; opened: number };

async function mailgunStats(days: number): Promise<{ stat: DeliveryStat | null; error: string | null }> {
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
    type Bucket = { total?: number; permanent?: { total?: number }; temporary?: { total?: number } };
    const json = (await res.json()) as { stats?: Record<string, Bucket>[] };
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

    const total: DeliveryStat = { delivered: 0, failed: 0, accepted: 0, opened: 0 };
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

export default async function EmailsAdmin(props: {
  searchParams: Promise<{ saved?: string; restored?: string; test?: string; to?: string; err?: string; days?: string }>;
}) {
  const sp = await props.searchParams;
  const windowDays = Math.min(30, Math.max(1, Number(sp.days) || 7));

  // Load every template once, then render each with its sample values so the
  // preview shows exactly what a student would receive.
  const loaded = await Promise.all(
    EMAIL_EVENTS.map(async (def) => {
      const tpl = await loadTemplate(def.key);
      const edited = tpl.subject !== def.subject || tpl.body !== def.body;
      const preview = renderTemplate(tpl, {
        ...def.sample,
        action_url: "https://caparveensharma.com/login",
        action_label: "Sample button",
      });
      return { def, tpl, edited, preview };
    }),
  );

  const Event = ({ def, tpl, edited, preview }: { def: EmailEventDef; tpl: { subject: string; body: string }; edited: boolean; preview: { subject: string; html: string } }) => (
    <details id={def.key} className="form-card" style={{ marginTop: 12 }} open={sp.saved === def.key || sp.restored === def.key}>
      <summary style={{ cursor: "pointer", fontWeight: 700 }}>
        {def.label} {edited ? <span className="muted" style={{ fontWeight: 400, fontSize: ".8rem" }}>· edited by you</span> : null}
      </summary>

      <p className="muted" style={{ fontSize: ".82rem", margin: "8px 0 12px" }}>{def.when}</p>

      <form action={saveEmailTemplate}>
        <input type="hidden" name="event" value={def.key} />
        <label>Subject line</label>
        <input name="subject" defaultValue={tpl.subject} />
        <label style={{ marginTop: 8 }}>Message</label>
        <textarea name="body" rows={Math.min(24, tpl.body.split("\n").length + 3)} defaultValue={tpl.body} style={{ fontFamily: "inherit", lineHeight: 1.55 }} />

        <div className="muted" style={{ fontSize: ".8rem", marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {def.vars.map((v) => (
            <span key={v.key}><code>{`{{${v.key}}}`}</code> — {v.note}</span>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <SubmitButton className="btn" savedLabel="✓ Saved">Save the wording</SubmitButton>
        </div>
      </form>

      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <form action={sendTestEmail}>
          <input type="hidden" name="event" value={def.key} />
          <button className="btn ghost" type="submit">Send a test to me</button>
        </form>
        <form action={restoreEmailDefault}>
          <input type="hidden" name="event" value={def.key} />
          <button className="btn ghost" type="submit">Back to the standard wording</button>
        </form>
      </div>

      <div style={{ marginTop: 14 }}>
        <div className="muted" style={{ fontSize: ".78rem", marginBottom: 6 }}>
          How it arrives — with sample details filled in:
        </div>
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 14, background: "#fff", color: "#0f172a" }}>
          <div style={{ fontSize: ".8rem", color: "#64748b", borderBottom: "1px solid #e2e8f0", paddingBottom: 6, marginBottom: 10 }}>
            <strong>Subject:</strong> {preview.subject}
          </div>
          <div dangerouslySetInnerHTML={{ __html: preview.html }} />
        </div>
      </div>
    </details>
  );

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 900 }}>
      <AdminHero
        badge="✉️ Emails"
        title="Every email the site sends"
        subtitle="Write the words once, here. Each one goes out on its own event — nothing is buried in the code. 📮"
        back={{ href: "/admin", label: "Admin" }}
      />

      {/* HOW MUCH ACTUALLY WENT OUT. Email counted by MAILGUN itself — our own
          log misses the sends that bypass it (114 vs 13 on the day this was
          built). WhatsApp and Telegram from our notifications log, plus the
          bot's group replies, with the gap named rather than papered over. */}
      {await (async () => {
        const svc = createServiceClient();
        const istMidnight = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
        istMidnight.setHours(0, 0, 0, 0);
        const midnightIso = new Date(istMidnight.getTime() - (istMidnight.getTimezoneOffset() - (-330)) * 60000);
        // count helper against notifications
        const cnt = async (channel: string, sinceIso: string) => {
          const { count } = await svc.from("notifications").select("id", { count: "exact", head: true })
            .eq("channel", channel).gte("sent_at", sinceIso);
          return count ?? 0;
        };
        const d30 = new Date(Date.now() - 30 * 864e5).toISOString();
        const dToday = midnightIso.toISOString();
        let mailToday = 0, mail30 = 0;
        try {
          const key = await getSecret("MAILGUN_API_KEY");
          const dom = await getSecret("MAILGUN_DOMAIN");
          const res = await fetch(`https://api.eu.mailgun.net/v3/${dom}/stats/total?event=accepted&duration=30d`, {
            headers: { Authorization: "Basic " + Buffer.from(`api:${key}`).toString("base64") }, cache: "no-store",
          });
          const j = (await res.json()) as { stats?: { time: string; accepted?: { total?: number } }[] };
          // Mailgun writes the bucket time as "Wed, 19 Aug 2026 00:00:00 UTC",
          // not ISO — matching it against an ISO date silently never fires and
          // the panel showed a dash for "today". Parse it properly.
          const today = new Date().toISOString().slice(0, 10);
          for (const st of j.stats ?? []) {
            const n = Number(st.accepted?.total) || 0;
            mail30 += n;
            const bucket = new Date(String(st.time));
            if (!Number.isNaN(bucket.getTime()) && bucket.toISOString().slice(0, 10) === today) mailToday = n;
          }
        } catch { /* the panel shows a dash rather than a guess */ }
        const [waT, wa30, tgT, tg30] = await Promise.all([
          cnt("whatsapp", dToday), cnt("whatsapp", d30), cnt("telegram", dToday), cnt("telegram", d30),
        ]);
        const { count: botT } = await svc.from("group_messages").select("id", { count: "exact", head: true })
          .eq("sender_name", "🤖 AI assistant").gte("created_at", dToday);
        const { count: bot30 } = await svc.from("group_messages").select("id", { count: "exact", head: true })
          .eq("sender_name", "🤖 AI assistant").gte("created_at", d30);
        const box: React.CSSProperties = { flex: 1, minWidth: 150 };
        return (
          <div className="card" style={{ marginTop: 16, display: "flex", gap: 20, flexWrap: "wrap" }}>
            <div style={box}>
              <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--accent)" }}>{mailToday || "—"}<span className="muted" style={{ fontSize: ".85rem", fontWeight: 400 }}> today</span></div>
              <div style={{ fontSize: ".85rem", fontWeight: 600 }}>✉️ Emails</div>
              <div className="muted" style={{ fontSize: ".76rem" }}>{mail30.toLocaleString("en-IN")} in 30 days · counted by Mailgun itself</div>
            </div>
            <div style={box}>
              <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--accent)" }}>{waT}<span className="muted" style={{ fontSize: ".85rem", fontWeight: 400 }}> today</span></div>
              <div style={{ fontSize: ".85rem", fontWeight: 600 }}>💬 WhatsApp</div>
              <div className="muted" style={{ fontSize: ".76rem" }}>{wa30.toLocaleString("en-IN")} in 30 days</div>
            </div>
            <div style={box}>
              <div style={{ fontSize: "1.5rem", fontWeight: 800, color: "var(--accent)" }}>{tgT + (botT ?? 0)}<span className="muted" style={{ fontSize: ".85rem", fontWeight: 400 }}> today</span></div>
              <div style={{ fontSize: ".85rem", fontWeight: 600 }}>✈️ Telegram</div>
              <div className="muted" style={{ fontSize: ".76rem" }}>{(tg30 + (bot30 ?? 0)).toLocaleString("en-IN")} in 30 days · direct messages + the bot&apos;s group answers</div>
            </div>
          </div>
        );
      })()}

      {/* DID IT ARRIVE — merged in from /admin/reports/email (19 Aug), because
          two email tiles meant nobody knew which one to open. Everything the
          report had lives on: the window chips, Mailgun's four counts, the
          verdict line, and the per-kind sent/not-sent list. */}
      {await (async () => {
        const svc = createServiceClient();
        const since = new Date(Date.now() - windowDays * 86400_000).toISOString();
        const [{ stat, error }, { data: ours }] = await Promise.all([
          mailgunStats(windowDays),
          svc.from("notifications").select("template, status").eq("channel", "email").gte("sent_at", since).limit(5000),
        ]);

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
        // Open tracking is off on the sending domain: zero means "not measured",
        // not "nobody read it".
        const opensTracked = Boolean(stat && stat.opened > 0);
        const kpis = [
          { icon: "📤", label: "Handed to Mailgun", value: stat ? String(stat.accepted) : "—" },
          { icon: "✅", label: "Delivered", value: stat ? String(stat.delivered) : "—" },
          { icon: "🚫", label: "Failed to arrive", value: stat ? String(stat.failed) : "—" },
          { icon: "👀", label: opensTracked ? "Opened" : "Opens not tracked", value: opensTracked ? String(stat!.opened) : "—" },
        ];

        return (
          <div className="card" style={{ marginTop: 16 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <strong>📬 Did it arrive?</strong>
              <span className="muted" style={{ fontSize: ".8rem" }}>Mailgun&apos;s own counts, not ours —</span>
              {[1, 7, 30].map((d) => (
                <a key={d} className={`btn small ${windowDays === d ? "" : "secondary"}`} style={{ marginBottom: 0 }} href={`/admin/emails?days=${d}`}>
                  {d === 1 ? "Today" : `${d} days`}
                </a>
              ))}
            </div>

            {error && <div className="notice err" style={{ marginTop: 10 }}>⚠️ {error}</div>}

            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 12 }}>
              {kpis.map((k) => (
                <div key={k.label} style={{ flex: 1, minWidth: 130 }}>
                  <div style={{ fontSize: "1.4rem", fontWeight: 800 }}>{k.icon} {k.value}</div>
                  <div className="muted" style={{ fontSize: ".8rem" }}>{k.label}</div>
                </div>
              ))}
            </div>

            {deliveredPct !== null && (
              <p style={{ margin: "12px 0 0", fontSize: ".9rem" }}>
                <strong>{deliveredPct}% of our email is arriving.</strong>{" "}
                <span className="muted">
                  {deliveredPct >= 97
                    ? "That is healthy. Nothing to do."
                    : deliveredPct >= 90
                      ? "A little low. Usually a handful of dead addresses — worth a look at the failures in Mailgun."
                      : "Too low. Students are not getting mail they are waiting for. Check the failures in Mailgun before sending anything else in bulk."}
                </span>
              </p>
            )}

            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: ".88rem" }}>
                📋 What the site sent in this period, by kind of message ({templates.length})
              </summary>
              <p className="muted" style={{ fontSize: ".82rem", margin: "8px 0 0" }}>
                Our own record of what was triggered. A kind with many &ldquo;not sent&rdquo; is a fault worth chasing —
                the student was owed that message.
              </p>
              <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
                {templates.length === 0 ? (
                  <p className="muted" style={{ margin: 0 }}>Nothing sent in this period.</p>
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
              <p className="muted" style={{ fontSize: ".8rem", margin: "10px 0 0" }}>
                Student mail written to us arrives separately and is answered automatically — see the{" "}
                <a href="/admin/doubt-log">doubt report</a>.
              </p>
            </details>
          </div>
        );
      })()}

      {/* THE FULL MAP FIRST — his ask, 19 Aug: one screen that says what
          triggers what mail. The editable templates below were only half the
          truth; a large share of the mail carries fixed wording at its
          send-site. Every automatic email is listed here: when it fires, who
          gets it, and whether its words can be edited on this page or live in
          code. */}
      <details style={{ marginTop: 16 }} open>
        <summary className="btn small secondary as-btn">🗺️ What triggers what — every automatic email, WhatsApp & Telegram message ({EMAIL_CATALOGUE.reduce((n, g) => n + g.entries.length, 0)})</summary>
        <div className="card" style={{ marginTop: 10 }}>
          <p className="muted" style={{ fontSize: ".84rem", lineHeight: 1.7, marginTop: 0 }}>
            <strong>✏️ editable</strong> means the wording is a template on this page — change it below and the next
            send uses your words. <strong>🔒 fixed</strong> means the words are written where the mail is sent; changing
            them is a code change, so ask for it. Some carry a WhatsApp copy alongside, noted where they do.
          </p>
          {EMAIL_CATALOGUE.map((g) => (
            <div key={g.group} style={{ marginTop: 14 }}>
              <strong style={{ fontSize: ".95rem" }}>{g.group}</strong>
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%", marginTop: 6, fontSize: ".83rem" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "4px 8px", color: "var(--muted)" }}>When</th>
                      <th style={{ textAlign: "left", padding: "4px 8px", color: "var(--muted)" }}>To</th>
                      <th style={{ textAlign: "left", padding: "4px 8px", color: "var(--muted)" }}>Subject</th>
                      <th style={{ textAlign: "left", padding: "4px 8px", color: "var(--muted)" }}>Wording</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.entries.map((e, i) => (
                      <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ padding: "6px 8px", minWidth: 220 }}>{e.trigger}</td>
                        <td style={{ padding: "6px 8px" }}>{e.to}</td>
                        <td style={{ padding: "6px 8px" }}>
                          {e.subject}
                          {e.channelNote && <div className="muted" style={{ fontSize: ".76rem" }}>💬 {e.channelNote}</div>}
                        </td>
                        <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                          {e.template?.startsWith("editable in") ? (
                            <a href="/admin/whatsapp" title={e.file}>✏️ {e.template}</a>
                          ) : e.template ? (
                            <a href={`#${e.template.split(" ")[0]}`} title={e.file}>✏️ editable below</a>
                          ) : (
                            <span className="muted" title={e.file}>🔒 fixed · {e.file.split("·")[0].trim().split("/").pop()}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </details>

      {sp.saved && <div className="notice ok" style={{ marginTop: 16 }}>✓ Saved — the next one sent uses this wording.</div>}
      {sp.restored && <div className="notice ok" style={{ marginTop: 16 }}>✓ Back to the standard wording.</div>}
      {sp.test === "sent" && <div className="notice ok" style={{ marginTop: 16 }}>✓ Test sent to {sp.to}. Check your inbox.</div>}
      {sp.test === "fail" && <div className="notice err" style={{ marginTop: 16 }}>Couldn&apos;t send the test — check the Mailgun key on Integrations.</div>}
      {sp.err && <div className="notice err" style={{ marginTop: 16 }}>Nothing was changed — that email isn&apos;t one we send.</div>}

      <div className="card" style={{ marginTop: 16 }}>
        <p style={{ margin: 0, fontSize: ".88rem" }}>
          Write plain sentences. A blank line starts a new paragraph, <code>**stars**</code> make a word bold, and any
          caparveensharma.com address becomes a link on its own. The words in <code>{"{{ }}"}</code> are filled in with
          the real details when the email goes out.
        </p>
        <p className="muted" style={{ margin: "10px 0 0", fontSize: ".84rem" }}>
          Where an email carries a link — setting a password, joining a class — put <code>{"{{button}}"}</code> on a line
          of its own and it becomes the button. The address itself is never printed: a login link is a single-use token,
          and a mail scanner that follows it uses it up before the student can. Leave the box empty to go back to the
          standard wording.
        </p>
      </div>

      {GROUPS.map((g) => {
        const items = loaded.filter((l) => l.def.group === g);
        if (!items.length) return null;
        return (
          <div key={g} style={{ marginTop: 26 }}>
            <h3 style={{ margin: "0 0 4px" }}>{g}</h3>
            {items.map((l) => <Event key={l.def.key} {...l} />)}
          </div>
        );
      })}

      <div className="card" style={{ marginTop: 26 }}>
        <strong style={{ fontSize: ".9rem" }}>Built from the student&apos;s own data — not written here</strong>
        <ul className="muted" style={{ fontSize: ".84rem", margin: "8px 0 0", paddingLeft: 18 }}>
          {GENERATED_EMAILS.map((g) => <li key={g}>{g}</li>)}
        </ul>
        <p className="muted" style={{ fontSize: ".8rem", margin: "8px 0 0" }}>
          These are tables and documents assembled from the student&apos;s marks, invoice or study plan, so there is no
          fixed wording to edit. Ask and I&apos;ll change how they read.
        </p>
      </div>
    </section>
  );
}
