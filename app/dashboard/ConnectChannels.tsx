"use client";

import { useState, useTransition } from "react";
import { ensureTelegramLink } from "./telegram-actions";

// Accept a bare number (919…) or a full URL; always produce a tappable wa.me link.
function waHref(v?: string): string | null {
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  const digits = v.replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : null;
}

// "Stay connected" card on the dashboard. We can't silently add students to
// channels, so we give one-tap join links + a personal bot-connect button.
export default function ConnectChannels({
  telegramChannel,
  techWhatsapp,
  facultyWhatsapp,
  alreadyLinked,
}: {
  telegramChannel?: string;
  techWhatsapp?: string;
  facultyWhatsapp?: string;
  alreadyLinked?: boolean;
}) {
  const [linked, setLinked] = useState(!!alreadyLinked);
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  const techWa = waHref(techWhatsapp);
  const facultyWa = waHref(facultyWhatsapp);

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
    <div className="card" style={{ marginTop: 18, border: "2px solid var(--accent)", background: "var(--bg-soft)" }}>
      <h3 style={{ marginBottom: 6, fontSize: "1.2rem" }}>🤝 Join our community</h3>
      <p className="muted" style={{ fontSize: ".9rem", marginBottom: 14 }}>
        Subscribe to the Telegram channel for updates, and reach our Faculty and Technical teams on WhatsApp.
        Every subject also has its own Telegram group — open the subject under <strong>My courses</strong> to join it.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {linked ? (
          <span className="badge" style={{ color: "#22c55e", borderColor: "#22c55e" }}>✅ Telegram connected</span>
        ) : (
          <button className="btn" type="button" disabled={pending} onClick={connectBot}
            style={{ background: "#229ED9" }}>
            {pending ? "…" : "✈️ Connect Telegram (doubts & alerts)"}
          </button>
        )}
        {telegramChannel && (
          <a className="btn" href={telegramChannel} target="_blank" rel="noopener noreferrer"
            style={{ background: "#229ED9", color: "#fff" }}>
            📢 Subscribe to our Telegram channel (updates)
          </a>
        )}
        {facultyWa && (
          <a className="btn secondary" href={facultyWa} target="_blank" rel="noopener noreferrer"
            style={{ background: "#25D366", color: "#fff" }}>
            👩‍🏫 WhatsApp the Faculty team
          </a>
        )}
        {techWa && (
          <a className="btn secondary" href={techWa} target="_blank" rel="noopener noreferrer"
            style={{ background: "#128C7E", color: "#fff" }}>
            🛠️ WhatsApp the Technical team
          </a>
        )}
      </div>
      <p className="muted" style={{ fontSize: ".8rem", marginTop: 10 }}>
        💡 Each subject also has its own Telegram group — open the subject under <strong>My courses</strong> to join it.
      </p>
      {note && <p className="muted" style={{ fontSize: ".82rem", marginTop: 10 }}>{note}</p>}
    </div>
  );
}
