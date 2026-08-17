import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import { logTouch, sendNudge } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mentoring desk — Admin" };

// ONE-TO-ONE MENTORING, ONE STUDENT AT A TIME.
//
// The founder wants students chased personally: somebody who studied for weeks
// and stopped should be asked why and told what backlog is building; somebody
// who never sits a test should be told to sit one.
//
// The order of the work came from the data rather than from the idea. Of the
// paying students, the overwhelming majority have never signed in even once,
// and almost none of them have a phone number on file — so the first group is a
// CALL LIST, not a message queue, and no amount of clever messaging will reach
// them. The trigger groups the founder described are real but small today; they
// grow as students actually start.
//
// Nothing here sends by itself. Every message is drafted, shown, editable, and
// waits for somebody to press send — and every call outcome is written down so
// the next person does not start the same conversation twice.

type Row = {
  student_id: string; full_name: string | null; email: string | null; phone: string | null;
  target_attempt: string | null; reason: string; priority: number;
  classes_done: number; days_studied: number; quiet_days: number | null;
  tests_taken: number; papers_sent: number;
  last_mark_pct: number | null; validity_days: number | null;
  ever_logged_in: boolean; phone_proven: boolean; on_telegram: boolean;
  last_touch: string | null; last_touch_outcome: string | null;
};

const REASONS: Record<string, { label: string; icon: string; what: string; call: boolean }> = {
  never_logged_in: {
    label: "Paid and never signed in", icon: "🚪", call: true,
    what: "They have access and have never once got through the door. Nothing else can happen until this does — and almost none of them have a number on file, so this group is worked by telephone and by post, not by message.",
  },
  never_started: {
    label: "Signed in, never opened a class", icon: "🧭", call: false,
    what: "They found the site and stopped. Usually they do not know where to begin — the answer is one specific chapter and the planner, not encouragement.",
  },
  streak_broken: {
    label: "Was studying, now gone quiet", icon: "📉", call: false,
    what: "A real habit, then silence. Say exactly how many days and what it now costs them, then ask what happened. This is the one the founder described.",
  },
  low_marks: {
    label: "Marks that need a conversation", icon: "🎯", call: true,
    what: "Under half marks. A nudge is the wrong tool: name the weak concept and which class to redo, and ideally say it out loud.",
  },
  no_tests: {
    label: "Studying but never testing", icon: "✅", call: false,
    what: "Watching classes and never checking whether any of it stuck. Point at one specific chapter test, not at tests in general.",
  },
  no_papers: {
    label: "Never sent a written paper", icon: "✍️", call: false,
    what: "Descriptive practice is where the marks are lost. Offer the free checking page and, if their connection is poor, offer to upload it for them.",
  },
  validity_short: {
    label: "Time running out, course untouched", icon: "⏳", call: true,
    what: "Be honest about what can still be finished in the days left, and what cannot. This conversation is better had early than at the end.",
  },
  doing_well: {
    label: "Doing well — say so", icon: "🌟", call: false,
    what: "A system that only speaks when you fail gets ignored. These are the students to praise by name.",
  },
};

/** A first draft with THEIR numbers in it. Editable before anything is sent. */
function draft(r: Row): string {
  const first = (r.full_name ?? "").split(" ")[0] || "there";
  switch (r.reason) {
    case "never_started":
      return `Dear ${first}, I can see your course is active but you have not opened a class yet. That is completely normal — the hardest part is knowing where to begin. Open the study planner, tell it your attempt${r.target_attempt ? ` (${r.target_attempt})` : ""}, and it will lay out exactly what to do today and every day after. If you would rather I pointed you at the first chapter myself, just reply.`;
    case "streak_broken":
      return `Dear ${first}, you were studying steadily — ${r.days_studied} days and ${r.classes_done} classes — and then it stopped about ${r.quiet_days} days ago. I am not writing to scold you; I want to know what happened, because ${r.quiet_days} days becomes a backlog quietly and then feels impossible. Tell me what got in the way and we will rebuild your plan around it.`;
    case "low_marks":
      return `Dear ${first}, I have looked at your papers — you are averaging about ${r.last_mark_pct}%. That is a fixable number and it is worth ten minutes on the phone rather than a message. Your report already names the concepts that cost you the marks and the exact classes to redo. When can we call you?`;
    case "no_tests":
      return `Dear ${first}, you have finished ${r.classes_done} classes, which is real work — but you have not sat a single test, so neither of us knows what has actually stuck. Please sit the chapter test for the last class you watched. It takes a few minutes and the report tells you which concept to go back to.`;
    case "no_papers":
      return `Dear ${first}, you have done ${r.classes_done} classes and not yet sent a written paper. In this exam the marks are lost in presentation and steps, not in knowing the topic. Send one paper — caparveensharma.com/check-my-paper — and it comes back marked against Sir's own answer key with the marking in the margin.`;
    case "validity_short":
      return `Dear ${first}, your access has about ${r.validity_days} days left and ${r.classes_done} classes are done so far. I would rather be straight with you than encouraging: let us decide together what can genuinely be finished in that time and build the plan around that.`;
    case "doing_well":
      return `Dear ${first}, this is not a reminder — it is a well done. ${r.days_studied} days of study and ${r.classes_done} classes finished is exactly the pattern that clears this exam. Keep going, and if you want your plan tightened for the last stretch, say so.`;
    default:
      return `Dear ${first},`;
  }
}

export default async function MentoringDesk(props: {
  searchParams: Promise<{ reason?: string; page?: string }>;
}) {
  const sp = await props.searchParams;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/mentoring");
  const { data: me } = await supabase.from("profiles").select("role, permissions").eq("id", user.id).maybeSingle();
  const role = me?.role as string | undefined;
  const perms = ((me as { permissions?: string[] } | null)?.permissions ?? []);
  if (role !== "admin" && !(role === "faculty" || perms.includes("students"))) redirect("/dashboard");

  const svc = createServiceClient();
  const { data: raw } = await svc.rpc("mentoring_queue", { days_since_touch: 14 });
  const all = (raw ?? []) as Row[];

  const counts = new Map<string, number>();
  for (const r of all) counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);

  const want = (sp.reason ?? "").trim();
  const rows = want ? all.filter((r) => r.reason === want) : all;

  // 25 at a time. The never-signed-in group runs to four figures and a mentor
  // works a list, not a wall.
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const perPage = 25;
  const shown = rows.slice((page - 1) * perPage, page * perPage);
  const pages = Math.max(1, Math.ceil(rows.length / perPage));

  const info = REASONS[want];
  const th: React.CSSProperties = { textAlign: "left", padding: "8px 10px", fontSize: ".76rem", textTransform: "uppercase", letterSpacing: ".04em", borderBottom: "2px solid var(--accent)" };
  const td: React.CSSProperties = { padding: "10px", borderBottom: "1px solid var(--border)", verticalAlign: "top", fontSize: ".88rem" };

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 1040 }}>
      <AdminHero
        badge="🤝 Mentoring desk"
        title="Who needs a word today"
        subtitle="One student at a time, with their own figures in front of you. Nothing sends by itself — every message is drafted, editable, and waits for you."
        back={{ href: "/admin", label: "Admin" }}
      />

      <div className="card" style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link className={`btn small ${want ? "secondary" : ""}`} href="/admin/mentoring">
          Everyone ({all.length})
        </Link>
        {Object.entries(REASONS).map(([key, r]) => {
          const n = counts.get(key) ?? 0;
          if (!n) return null;
          return (
            <Link key={key} className={`btn small ${want === key ? "" : "secondary"}`} href={`/admin/mentoring?reason=${key}`}>
              {r.icon} {r.label} ({n})
            </Link>
          );
        })}
      </div>

      {info && (
        <div className="notice" style={{ marginTop: 12, fontSize: ".9rem", lineHeight: 1.7 }}>
          <strong>{info.icon} {info.label}.</strong> {info.what}
          {info.call && <> <strong>Best done on the phone.</strong></>}
        </div>
      )}

      {!want && (
        <div className="card" style={{ marginTop: 12, fontSize: ".88rem", lineHeight: 1.75, color: "var(--muted)" }}>
          <p style={{ marginTop: 0 }}>
            <strong>Read the groups in order.</strong> They are sorted by how much difference a conversation makes,
            not by how many people are in them. The first group — paid and never signed in — is the largest by a wide
            margin and the only one where nothing else can help until it is solved. Almost none of them have a phone
            number on file, so it is worked with a telephone and their email address, one at a time.
          </p>
          <p style={{ margin: 0 }}>
            A student drops off this list for a fortnight once you log a call or send a message, so nobody is chased
            twice for the same thing.
          </p>
        </div>
      )}

      <div className="card" style={{ marginTop: 14, overflowX: "auto" }}>
        {shown.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>Nobody in this group right now.</p>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={th}>Student</th>
                <th style={th}>Where they are</th>
                <th style={th}>Reach them</th>
                <th style={th}>What to do</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.student_id}>
                  <td style={td}>
                    <Link href={`/admin/users/${r.student_id}`} style={{ fontWeight: 700 }}>
                      {r.full_name || r.email || "—"}
                    </Link>
                    {!want && (
                      <div className="muted" style={{ fontSize: ".78rem" }}>
                        {REASONS[r.reason]?.icon} {REASONS[r.reason]?.label ?? r.reason}
                      </div>
                    )}
                    {r.target_attempt && <div className="muted" style={{ fontSize: ".78rem" }}>🎯 {r.target_attempt}</div>}
                    {r.last_touch && (
                      <div style={{ fontSize: ".76rem", color: "#b45309" }}>
                        last spoken to {new Date(r.last_touch).toLocaleDateString("en-IN")} · {r.last_touch_outcome}
                      </div>
                    )}
                  </td>
                  <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>
                    {r.ever_logged_in ? (
                      <>
                        {r.classes_done} classes · {r.days_studied} days
                        {r.quiet_days != null && <> · quiet {r.quiet_days}d</>}
                        <div className="muted" style={{ fontSize: ".78rem" }}>
                          {r.tests_taken} tests · {r.papers_sent} papers
                          {r.last_mark_pct != null && <> · {r.last_mark_pct}%</>}
                          {r.validity_days != null && <> · {r.validity_days}d validity</>}
                        </div>
                      </>
                    ) : (
                      <em className="muted">never signed in</em>
                    )}
                  </td>
                  <td style={{ ...td, fontSize: ".82rem" }}>
                    {r.phone ? (
                      <a href={`tel:+91${String(r.phone).replace(/\D/g, "").slice(-10)}`}>
                        📞 {String(r.phone).replace(/\D/g, "").slice(-10)}
                      </a>
                    ) : (
                      <span style={{ color: "#b91c1c" }}>no number</span>
                    )}
                    {r.phone && !r.phone_proven && (
                      <div className="muted" style={{ fontSize: ".74rem" }}>not verified</div>
                    )}
                    <div className="muted" style={{ fontSize: ".76rem", wordBreak: "break-all" }}>{r.email}</div>
                    {r.on_telegram && <div style={{ fontSize: ".76rem" }}>✈️ on Telegram</div>}
                  </td>
                  <td style={td}>
                    {/* Log a call. The whole group above may be worked this way. */}
                    <form action={logTouch} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <input type="hidden" name="student_id" value={r.student_id} />
                      <input type="hidden" name="reason" value={r.reason} />
                      <select name="outcome" defaultValue="spoke" style={{ marginBottom: 0, fontSize: ".82rem", maxWidth: 150 }}>
                        <option value="spoke">Spoke to them</option>
                        <option value="promised">Promised to resume</option>
                        <option value="no_answer">No answer</option>
                        <option value="wrong_number">Wrong number</option>
                        <option value="refused">Not interested</option>
                        <option value="unreachable">Could not reach</option>
                      </select>
                      <input name="note" placeholder="What they said" style={{ marginBottom: 0, fontSize: ".82rem", maxWidth: 190 }} />
                      <SubmitButton className="btn small secondary">Log</SubmitButton>
                    </form>

                    {/* And the drafted message, if there is anywhere to send it. */}
                    {r.reason !== "never_logged_in" && (
                      <details style={{ marginTop: 8 }}>
                        <summary className="btn small secondary as-btn" style={{ fontSize: ".8rem" }}>
                          ✍️ Draft a message
                        </summary>
                        <form action={sendNudge} style={{ marginTop: 8 }}>
                          <input type="hidden" name="student_id" value={r.student_id} />
                          <input type="hidden" name="reason" value={r.reason} />
                          <textarea name="body" rows={7} defaultValue={draft(r)} style={{ fontSize: ".82rem", width: "100%" }} />
                          <p className="muted" style={{ fontSize: ".74rem", margin: "0 0 6px" }}>
                            Written from their own figures. Change anything you like — what is sent is what is in this
                            box, and it is logged word for word.
                          </p>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <SubmitButton className="btn small" name="channel" value="email">📧 Send email</SubmitButton>
                            {r.phone && (
                              <SubmitButton className="btn small" name="channel" value="whatsapp">💬 Send WhatsApp</SubmitButton>
                            )}
                          </div>
                        </form>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pages > 1 && (
        <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {page > 1 && (
            <Link className="btn small secondary" href={`/admin/mentoring?${want ? `reason=${want}&` : ""}page=${page - 1}`}>← Previous</Link>
          )}
          <span className="muted" style={{ fontSize: ".85rem" }}>Page {page} of {pages} · {rows.length} students</span>
          {page < pages && (
            <Link className="btn small secondary" href={`/admin/mentoring?${want ? `reason=${want}&` : ""}page=${page + 1}`}>Next →</Link>
          )}
        </div>
      )}

      <div className="card" style={{ marginTop: 16, fontSize: ".85rem", lineHeight: 1.75, color: "var(--muted)" }}>
        <p style={{ marginTop: 0 }}>
          <strong>Why WhatsApp is greyed out for most of this list.</strong> A message needs a number, and a number we
          have never proved may be mistyped. Of everyone who has ever signed in, only a handful have verified their
          number — which is what the phone-verification prompt on the dashboard is now collecting. Every verified
          number turns a student from unreachable into someone you can actually mentor, so that figure is worth
          watching more than any other on this page.
        </p>
        <p style={{ margin: 0 }}>
          Papers waiting to be marked are on the <Link href="/examiner">examiner desk</Link>; how uploads are going is
          under <Link href="/admin/reports/papers">Paper report</Link>.
        </p>
      </div>
    </section>
  );
}
