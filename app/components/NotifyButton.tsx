"use client";

import { useState, useTransition } from "react";
import { subscribeReminder } from "@/app/actions/engagement";

// "Notify me" for a live class/event. Logged-in students submit in one click;
// logged-out visitors get a small email field.
export default function NotifyButton({
  sessionId,
  signedIn,
}: {
  sessionId?: string;
  signedIn?: boolean;
}) {
  const [done, setDone] = useState(false);
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [pending, start] = useTransition();

  function submit(withEmail: string) {
    const fd = new FormData();
    if (sessionId) fd.set("session_id", sessionId);
    if (withEmail) fd.set("email", withEmail);
    start(async () => {
      const r = await subscribeReminder(fd);
      if (r.ok) setDone(true);
    });
  }

  if (done) return <span className="muted" style={{ fontSize: ".85rem" }}>🔔 You&apos;ll be notified ✅</span>;

  if (signedIn) {
    return (
      <button className="btn small secondary" disabled={pending} onClick={() => submit("")}>
        {pending ? "…" : "🔔 Notify me"}
      </button>
    );
  }

  if (!open) {
    return (
      <button className="btn small secondary" onClick={() => setOpen(true)}>
        🔔 Notify me
      </button>
    );
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
      <input
        type="email"
        placeholder="your@email.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border)", fontSize: ".85rem", width: 170 }}
      />
      <button
        className="btn small"
        disabled={pending || !email.includes("@")}
        onClick={() => submit(email)}
      >
        {pending ? "…" : "Notify me"}
      </button>
    </span>
  );
}
