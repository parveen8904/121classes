import { createServiceClient } from "@/lib/supabase/service";
import { emailConfigured, whatsappConfigured, telegramConfigured } from "@/lib/notify";
import AdminHero from "../_components/AdminHero";
import { broadcast } from "./actions";

export const dynamic = "force-dynamic";

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: { tg?: string; em?: string; emt?: string; dm?: string; dmt?: string };
}) {
  const tgOn = await telegramConfigured();
  const emOn = await emailConfigured();
  const waOn = await whatsappConfigured();

  // Audience size (students with contact info).
  const svc = createServiceClient();
  const { count: studentCount } = await svc
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "student");

  const sentEmail = Number(searchParams.em ?? 0);
  const totalEmail = Number(searchParams.emt ?? 0);
  const showResult = searchParams.tg || searchParams.em;

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
        subtitle="Broadcast an update to your students by Telegram, email & WhatsApp. 📲"
        back={{ href: "/admin", label: "Admin" }}
      />

      {showResult && (
        <div className="notice ok" style={{ marginTop: 16 }}>
          {searchParams.tg === "ok" && "✅ Posted to your Telegram channel (all members). "}
          {searchParams.tg === "fail" && "⚠️ Telegram post failed — check the bot token. "}
          {totalEmail > 0 && `✉️ Emailed ${sentEmail}/${totalEmail} students${totalEmail >= 500 ? " (first 500 this batch — send again for the rest)" : ""}. `}
          {Number(searchParams.dmt ?? 0) > 0 && `✈️ Sent ${Number(searchParams.dm ?? 0)}/${Number(searchParams.dmt ?? 0)} personal Telegram messages.`}
        </div>
      )}

      <div style={{ marginTop: 18, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Pill on={tgOn} label="Telegram" />
        <Pill on={emOn} label="Email" />
        <Pill on={waOn} label="WhatsApp" />
        <span className="muted" style={{ fontSize: ".82rem", alignSelf: "center" }}>
          {studentCount ?? 0} students
        </span>
      </div>

      <div className="form-card" style={{ marginTop: 18 }}>
        <h3>✍️ Compose</h3>
        <form action={broadcast}>
          <label>Title</label>
          <input name="title" placeholder="e.g. New FR class is live!" required />
          <label>Message</label>
          <textarea name="body" rows={4} placeholder="Write your update…" />
          <label>Link (optional)</label>
          <input name="link" placeholder="https://121caclasses.com/…" />

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
          </div>

          <button className="btn" type="submit" style={{ marginTop: 16 }}>
            Send notification
          </button>
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
