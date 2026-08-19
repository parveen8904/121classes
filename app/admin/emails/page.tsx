import AdminHero from "../_components/AdminHero";
import { EMAIL_CATALOGUE } from "@/lib/emailCatalogue";
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

export default async function EmailsAdmin(props: {
  searchParams: Promise<{ saved?: string; restored?: string; test?: string; to?: string; err?: string }>;
}) {
  const sp = await props.searchParams;

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
