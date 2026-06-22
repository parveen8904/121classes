import { ensureTelegramLink } from "./telegram-actions";

// One-tap "Connect Telegram" for daily targets + reminders. Hidden until the
// bot is configured (TELEGRAM_BOT_USERNAME). Shows a confirmation once linked.
export default async function ConnectTelegram() {
  const t = await ensureTelegramLink();
  if (t.linked) {
    return (
      <div className="card" style={{ marginTop: 14, borderColor: "#16a34a" }}>
        <p style={{ margin: 0 }}>✅ <strong>Telegram connected</strong> — you&apos;ll get your daily study target &amp; reminders here.</p>
      </div>
    );
  }
  if (!t.configured || !t.url) return null;
  return (
    <div className="card" style={{ marginTop: 14, border: "2px solid var(--accent)" }}>
      <strong>📲 Get your daily target on Telegram</strong>
      <p className="muted" style={{ fontSize: ".85rem", margin: "6px 0 10px" }}>Connect once to receive each day&apos;s study target and progress nudges on Telegram.</p>
      <a className="btn" href={t.url} target="_blank" rel="noopener noreferrer">🔗 Connect Telegram</a>
    </div>
  );
}
