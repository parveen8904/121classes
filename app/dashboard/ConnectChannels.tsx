"use client";

import { useState, useTransition } from "react";
import { ensureTelegramLink } from "./telegram-actions";

// "Stay connected" card on the dashboard. We can't silently add students to
// channels, so we give one-tap join links + a personal bot-connect button.
export default function ConnectChannels({
  telegramChannel,
  whatsapp,
  alreadyLinked,
}: {
  telegramChannel?: string;
  whatsapp?: string;
  alreadyLinked?: boolean;
}) {
  const [linked, setLinked] = useState(!!alreadyLinked);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  function connectBot() {
    start(async () => {
      const r = await ensureTelegramLink();
      if (r.linked) {
        setLinked(true);
      } else if (r.url) {
        window.open(r.url, "_blank");
        setNote("Telegram opened — tap Start there to finish connecting.");
      } else {
        setNote("The Telegram bot isn't set up yet — please check back soon.");
      }
    });
  }

  return (
    <div className="card" style={{ marginTop: 18 }}>
      <h3 style={{ marginBottom: 6 }}>📲 Stay connected</h3>
      <p className="muted" style={{ fontSize: ".88rem", marginBottom: 12 }}>
        Get class alerts and ask doubts on the go.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {linked ? (
          <span className="badge" style={{ color: "#22c55e", borderColor: "#22c55e" }}>✅ Telegram connected</span>
        ) : (
          <button className="btn small" type="button" disabled={pending} onClick={connectBot}
            style={{ background: "#229ED9" }}>
            {pending ? "…" : "✈️ Connect Telegram (doubts & alerts)"}
          </button>
        )}
        {telegramChannel && (
          <a className="btn small secondary" href={telegramChannel} target="_blank" rel="noopener noreferrer">
            📢 Join our channel
          </a>
        )}
        {whatsapp && (
          <a className="btn small secondary" href={whatsapp} target="_blank" rel="noopener noreferrer"
            style={{ background: "#25D366", color: "#fff" }}>
            💬 Join WhatsApp
          </a>
        )}
      </div>
      {note && <p className="muted" style={{ fontSize: ".82rem", marginTop: 10 }}>{note}</p>}
    </div>
  );
}
