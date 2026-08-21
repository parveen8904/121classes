import { formatDate } from "@/lib/dates";
import { createServiceClient } from "@/lib/supabase/service";
import SubmitButton from "@/app/components/SubmitButton";
import { emailConfigured, whatsappConfigured, telegramConfigured } from "@/lib/notify";
import { pushConfigured } from "@/lib/push";
import { reachStats } from "@/lib/reachStats";
import AdminHero from "../_components/AdminHero";
import { broadcast } from "./actions";

export const dynamic = "force-dynamic";

export default async function NotificationsPage(
  props: {
    searchParams: Promise<{ tg?: string; em?: string; emt?: string; dm?: string; dmt?: string; ps?: string; pst?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const tgOn = await telegramConfigured();
  const emOn = await emailConfigured();
  const waOn = await whatsappConfigured();
  const pushOn = await pushConfigured();

  // Audience size (students with contact info).
  const svc = createServiceClient();
  const { count: studentCount } = await svc
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "student");

  // Audience options: send to everyone, a whole course, a single subject/batch,
  // or one named student.
  const [{ data: courseRows }, { data: subjectRows }] = await Promise.all([
    svc.from("courses").select("id, title").order("title"),
    svc.from("subjects").select("id, title, courses(title)").order("title"),
  ]);
  const courses = (courseRows ?? []) as { id: string; title: string }[];
  const subjects = (subjectRows ?? []) as { id: string; title: string; courses?: { title?: string } | null }[];

  const { count: deviceCount } = await svc
    .from("push_devices")
    .select("token", { count: "exact", head: true })
    .is("disabled_at", null);

  const sentEmail = Number(searchParams.em ?? 0);
  const totalEmail = Number(searchParams.emt ?? 0);
  const showResult = searchParams.tg || searchParams.em || searchParams.pst;

  const Pill = ({ on, label }: { on: boolean; label: string }) => (
    <span className="badge" style={{ background: on ? "rgba(34,197,94,.15)" : "var(--bg-soft)", color: on ? "#22c55e" : "var(--muted)", borderColor: on ? "#22c55e" : "var(--border)" }}>
      {on ? "● " : "○ "}{label}
    </span>
  );

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="📣 Notify students"
        title="Send a notification"
        subtitle="Broadcast an update to your students by Telegram, email, WhatsApp & straight to their phones. 📲"
        back={{ href: "/admin", label: "Admin" }}
      />

      {showResult && (
        <div className="notice ok" style={{ marginTop: 16 }}>
          {searchParams.tg === "ok" && "✅ Posted to your Telegram channel (all members). "}
          {searchParams.tg === "fail" && "⚠️ Telegram post failed — check the bot token. "}
          {totalEmail > 0 && `✉️ Emailed ${sentEmail}/${totalEmail} students${totalEmail >= 500 ? " (first 500 this batch — send again for the rest)" : ""}. `}
          {Number(searchParams.dmt ?? 0) > 0 && `✈️ Sent ${Number(searchParams.dm ?? 0)}/${Number(searchParams.dmt ?? 0)} personal Telegram messages.`}
          {Number(searchParams.pst ?? 0) > 0 && `📲 Pushed to ${Number(searchParams.ps ?? 0)}/${Number(searchParams.pst ?? 0)} phones.`}
        </div>
      )}

      <div style={{ marginTop: 18, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Pill on={tgOn} label="Telegram" />
        <Pill on={emOn} label="Email" />
        <Pill on={waOn} label="WhatsApp" />
        <Pill on={pushOn} label="App notifications" />
        <span className="muted" style={{ fontSize: ".82rem", alignSelf: "center" }}>
          {studentCount ?? 0} students · {deviceCount ?? 0} phones with the app
        </span>
      </div>

      <ReachPanel />

      <div className="form-card" style={{ marginTop: 18 }}>
        <h3>✍️ Compose</h3>
        <form action={broadcast}>
          <label>Title</label>
          <input name="title" placeholder="e.g. New FR class is live!" required />
          <label>Message</label>
          <textarea name="body" rows={4} placeholder="Write your update…" />
          <label>Link (optional)</label>
          <input name="link" placeholder="https://caparveensharma.com/…" />

          <label style={{ marginTop: 12 }}>👥 Who should get it?</label>
          <select name="audience" defaultValue="all">
            <option value="all">All students</option>
            {courses.map((c) => (
              <option key={c.id} value={`course:${c.id}`}>Course — {c.title} (everyone enrolled)</option>
            ))}
            {subjects.map((s) => (
              <option key={s.id} value={`subject:${s.id}`}>
                Batch — {s.title}{s.courses?.title ? ` (${s.courses.title})` : ""} — enrolled only
              </option>
            ))}
          </select>
          <p className="muted" style={{ fontSize: ".8rem", margin: "4px 0 0" }}>
            A course or batch reaches only students with an <strong>active enrolment</strong> in it. Or send to one student:
          </p>
          <input name="audience_email" type="email" placeholder="…or a single student's email (overrides the choice above)" style={{ marginTop: 6 }} />
          <p className="muted" style={{ fontSize: ".78rem", margin: "4px 0 0" }}>
            Note: the public <strong>Telegram channel</strong> and <strong>Discord</strong> reach everyone, so they are skipped when you pick a course, batch or single student — the message then goes only by personal Telegram, email and app notification.
          </p>

          <p className="muted" style={{ fontSize: ".85rem", margin: "12px 0 6px" }}>Send via:</p>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
            <label className="remember" style={{ margin: 0, opacity: tgOn ? 1 : 0.5 }}>
              <input type="checkbox" name="ch_telegram" defaultChecked={tgOn} disabled={!tgOn} /> ✈️ Telegram channel (reaches all)
            </label>
            <label className="remember" style={{ margin: 0 }}>
              <input type="checkbox" name="ch_discord" defaultChecked /> 🎮 Discord channel
            </label>
            <label className="remember" style={{ margin: 0, opacity: tgOn ? 1 : 0.5 }}>
              <input type="checkbox" name="ch_telegram_dm" disabled={!tgOn} /> 📨 Telegram personal messages (to connected students)
            </label>
            <label className="remember" style={{ margin: 0, opacity: emOn ? 1 : 0.5 }}>
              <input type="checkbox" name="ch_email" defaultChecked={false} disabled={!emOn} /> ✉️ Email students
            </label>
            {/* The only channel here that reaches a student who has not opened
                anything — so it is the loudest, and it is off by default. */}
            <label className="remember" style={{ margin: 0, opacity: pushOn ? 1 : 0.5 }}>
              <input type="checkbox" name="ch_push" defaultChecked={false} disabled={!pushOn} /> 📲 App notification (iPhone &amp; Android)
              {/* WHAT THIS NUMBER IS, WRITTEN NEXT TO IT.
                  It is not app users and it is not readers. It is phones that
                  installed the app, signed in AND allowed notifications —
                  always fewer than the people using the app, because allowing
                  notifications is a separate yes. */}
              <span className="muted" style={{ display: "block", fontSize: ".8rem", lineHeight: 1.6, marginTop: 4 }}>
                Goes to <strong>{deviceCount ?? 0} phone(s)</strong> that have the app and allowed notifications.
                That is fewer than the number of students using the app — allowing notifications is a separate yes,
                and many never give it. Nothing tells us who opened a notification, only which phones it reached.
              </span>
            </label>
          </div>

          <SubmitButton className="btn" style={{ marginTop: 16 }}>
            Send notification
          </SubmitButton>
        </form>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <p className="muted" style={{ fontSize: ".85rem", margin: 0 }}>
          <strong>How it scales:</strong> ✈️ <strong>Telegram</strong> is one post to your channel — it reaches{" "}
          <strong>every member instantly</strong>, at any size. ✉️ <strong>Email</strong> sends to 500 students per
          click (click again for the next batch); for true 20k one-tap email/WhatsApp I can add a background queue.
          {!tgOn && " Add TELEGRAM_BOT_TOKEN (and make the bot a channel admin) to enable Telegram."}
          {!emOn && " Add MAILGUN_API_KEY + MAILGUN_DOMAIN to enable email."}
          {!waOn && " WhatsApp needs INTERAKT_API_KEY + an approved template."}
        </p>
      </div>
    </section>
  );
}

/**
 * How many people are behind each tick on the compose form.
 *
 * Written after a notification appeared not to arrive on an iPhone. It had
 * arrived nowhere, because at the moment it was sent no iPhone had registered
 * yet — and there was no screen anywhere that would have shown that.
 */
async function ReachPanel() {
  const channels = await reachStats();

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <h2 style={{ margin: 0, fontSize: "1.05rem" }}>📊 Who each channel reaches</h2>
      <p className="muted" style={{ margin: "6px 0 12px", fontSize: ".85rem" }}>
        Counted now, from the database.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 10 }}>
        {channels.map((c) => (
          <div key={c.key} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <strong style={{ fontSize: ".9rem" }}>{c.label}</strong>
              <span style={{ fontSize: "1.2rem", fontWeight: 700 }}>
                {c.count < 0 ? "—" : c.count.toLocaleString("en-IN")}
              </span>
            </div>
            {c.note && (
              <p className="muted" style={{ margin: "4px 0 0", fontSize: ".76rem", lineHeight: 1.5 }}>{c.note}</p>
            )}
            {c.people.length > 0 && (
              <details style={{ marginTop: 6 }}>
                <summary style={{ cursor: "pointer", fontSize: ".78rem" }}>
                  Who ({c.people.length}{c.count > c.people.length ? ` of ${c.count}` : ""})
                </summary>
                <ul style={{ margin: "6px 0 0 16px", padding: 0, fontSize: ".78rem", lineHeight: 1.7 }}>
                  {c.people.map((p, i) => (
                    <li key={i}>
                      {p.name}
                      {p.detail && p.detail !== p.name && (
                        <span className="muted"> · {p.detail}</span>
                      )}
                      {p.when && (
                        <span className="muted">
                          {" "}· {formatDate(p.when)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
