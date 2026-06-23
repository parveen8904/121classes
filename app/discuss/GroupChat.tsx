"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { postToGroup } from "./actions";

type Group = { subjectId: string; title: string };
type Msg = { id: string; sender_name: string | null; sender_user_id: string | null; body: string | null; created_at: string; source: string };

export default function GroupChat({ groups, meId, meName }: { groups: Group[]; meId: string; meName: string }) {
  const supabase = createClient();
  const [active, setActive] = useState(groups[0]?.subjectId ?? "");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeGroup = groups.find((g) => g.subjectId === active);

  const load = useCallback(
    async (subjectId: string) => {
      const { data } = await supabase
        .from("group_messages")
        .select("id, sender_name, sender_user_id, body, created_at, source")
        .eq("subject_id", subjectId)
        .eq("status", "visible")
        .order("created_at", { ascending: true })
        .limit(200);
      setMsgs((data ?? []) as Msg[]);
    },
    [supabase],
  );

  useEffect(() => {
    if (!active) return;
    load(active);
    const ch = supabase
      .channel(`gm:${active}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "group_messages", filter: `subject_id=eq.${active}` },
        (payload) => {
          const m = payload.new as Msg & { status: string };
          if (m.status === "visible") setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [active, supabase, load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  async function send() {
    const t = text.trim();
    if (!t || !activeGroup || busy) return;
    setBusy(true);
    setNote(null);
    const r = await postToGroup({ subjectId: activeGroup.subjectId, text: t });
    setBusy(false);
    if (!r.ok) {
      setNote(r.error ?? "Could not send.");
      return;
    }
    setText("");
    load(active); // realtime also delivers it; this is a fast fallback
  }

  return (
    <div>
      {groups.length > 1 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {groups.map((g) => (
            <button key={g.subjectId} type="button" onClick={() => setActive(g.subjectId)}
              className="btn small" style={{ background: g.subjectId === active ? "#229ED9" : "var(--bg-soft)", color: g.subjectId === active ? "#fff" : "var(--text)" }}>
              {g.title}
            </button>
          ))}
        </div>
      )}

      <div style={{ border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", background: "var(--bg-soft)" }}>
        <div style={{ height: 460, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {msgs.length === 0 ? (
            <p className="muted" style={{ textAlign: "center", marginTop: 30, fontSize: ".9rem" }}>No messages yet — say hello 👋</p>
          ) : (
            msgs.map((m) => {
              const mine = m.sender_user_id === meId;
              return (
                <div key={m.id} style={{ alignSelf: mine ? "flex-end" : "flex-start", maxWidth: "80%" }}>
                  <div style={{ background: mine ? "var(--accent)" : "var(--card)", color: mine ? "#fff" : "var(--text)", border: mine ? "none" : "1px solid var(--border)", borderRadius: 12, padding: "7px 11px" }}>
                    {!mine && <div style={{ fontSize: ".72rem", fontWeight: 700, color: "var(--accent)", marginBottom: 2 }}>{m.sender_name || "Member"}</div>}
                    <div style={{ whiteSpace: "pre-wrap", fontSize: ".92rem" }}>{m.body}</div>
                    <div style={{ fontSize: ".62rem", opacity: 0.7, textAlign: "right", marginTop: 2 }}>
                      {new Date(m.created_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        <div style={{ display: "flex", gap: 8, padding: 10, borderTop: "1px solid var(--border)", background: "var(--card)" }}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={`Message ${activeGroup?.title ?? ""}…`}
            style={{ flex: 1, marginBottom: 0 }}
            maxLength={2000}
          />
          <button className="btn" type="button" disabled={busy || !text.trim()} onClick={send}>{busy ? "…" : "Send"}</button>
        </div>
      </div>
      {note && <p className="muted" style={{ color: "#dc2626", fontSize: ".85rem", marginTop: 8 }}>{note}</p>}
      <p className="muted" style={{ fontSize: ".75rem", marginTop: 8 }}>Synced live with Telegram · {meName}. Ads, links, phone numbers &amp; abuse are removed automatically.</p>
    </div>
  );
}
