"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { shareToCommunity, shareToTelegram } from "./actions";
import PaperTools from "./PaperTools";

export type Msg = {
  id: string;
  kind: "question" | "paper";
  when: string;
  title: string;
  status: string;
  shareText: string;
  answers?: { text: string; kind: string }[];
  // paper-only:
  score?: number | null;
  max?: number;
  yourAnswer?: string;
  feedback?: string | null;
  suggested?: string;
};

const LS_FOLDERS = "inbox_folders";
const LS_LABELS = "inbox_labels";

function fmt(s: string) {
  return new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export default function InboxView({
  messages,
  performance,
  recs,
}: {
  messages: Msg[];
  performance: { mcqCount: number; paperCount: number };
  recs: { concepts: string[]; topics: { id: string; title: string; subject?: { title?: string } | null }[]; material: { id: string; title: string }[] } | null;
}) {
  const [folder, setFolder] = useState("All");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [customFolders, setCustomFolders] = useState<string[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    try {
      setCustomFolders(JSON.parse(localStorage.getItem(LS_FOLDERS) || "[]"));
      setLabels(JSON.parse(localStorage.getItem(LS_LABELS) || "{}"));
    } catch {}
  }, []);

  function saveFolders(f: string[]) {
    setCustomFolders(f);
    try { localStorage.setItem(LS_FOLDERS, JSON.stringify(f)); } catch {}
  }
  function setLabel(id: string, name: string) {
    const next = { ...labels };
    if (name) next[id] = name; else delete next[id];
    setLabels(next);
    try { localStorage.setItem(LS_LABELS, JSON.stringify(next)); } catch {}
  }
  function newFolder() {
    const name = prompt("New folder name:")?.trim();
    if (name && !customFolders.includes(name)) saveFolders([...customFolders, name]);
  }

  const counts = useMemo(() => ({
    All: messages.length,
    Questions: messages.filter((m) => m.kind === "question").length,
    Papers: messages.filter((m) => m.kind === "paper").length,
  }), [messages]);

  const visible = useMemo(() => {
    let list = messages;
    if (folder === "Questions") list = list.filter((m) => m.kind === "question");
    else if (folder === "Papers") list = list.filter((m) => m.kind === "paper");
    else if (folder !== "All" && folder !== "Performance") list = list.filter((m) => labels[m.id] === folder);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((m) => (m.title + " " + (m.answers?.map((a) => a.text).join(" ") ?? "") + " " + (m.feedback ?? "")).toLowerCase().includes(q));
    }
    return list;
  }, [messages, folder, search, labels]);

  const folderBtn = (name: string, label: string, count?: number) => (
    <button
      key={name}
      onClick={() => { setFolder(name); setOpen(null); }}
      className="inbox-folder"
      style={{ fontWeight: folder === name ? 800 : 500, background: folder === name ? "var(--bg-soft)" : "transparent" }}
    >
      <span>{label}</span>
      {count !== undefined && <span className="muted" style={{ fontSize: ".78rem" }}>{count}</span>}
    </button>
  );

  return (
    <div className="inbox-grid">
      {/* Folder rail */}
      <aside className="inbox-rail no-print">
        {folderBtn("All", "📥 All", counts.All)}
        {folderBtn("Questions", "❓ Questions", counts.Questions)}
        {folderBtn("Papers", "📝 Papers", counts.Papers)}
        {folderBtn("Performance", "📊 Performance")}
        {customFolders.length > 0 && <div className="muted" style={{ fontSize: ".72rem", margin: "12px 8px 4px", textTransform: "uppercase", letterSpacing: ".05em" }}>My folders</div>}
        {customFolders.map((f) => folderBtn(f, `📁 ${f}`, messages.filter((m) => labels[m.id] === f).length))}
        <button className="inbox-folder" onClick={newFolder} style={{ color: "var(--accent)", fontWeight: 600 }}>＋ New folder</button>
      </aside>

      {/* Main */}
      <div>
        <input
          className="no-print"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍 Search your inbox…"
          style={{ width: "100%", padding: "10px 14px", borderRadius: 999, border: "1px solid var(--border)", marginBottom: 14 }}
        />

        {folder === "Performance" ? (
          <div className="card">
            <h3 style={{ margin: "0 0 6px" }}>📊 Performance summary</h3>
            <p className="muted" style={{ margin: 0 }}>
              You&apos;ve attempted <strong>{performance.mcqCount}</strong> MCQ test{performance.mcqCount === 1 ? "" : "s"} and{" "}
              <strong>{performance.paperCount}</strong> descriptive paper{performance.paperCount === 1 ? "" : "s"}.
            </p>
            <Link className="btn small" style={{ marginTop: 10 }} href="/learn/performance">See full performance &amp; ranking →</Link>
          </div>
        ) : (
          <>
            {folder === "All" && recs && (recs.topics.length > 0 || recs.material.length > 0) && (
              <div className="card" style={{ borderColor: "var(--accent)", marginBottom: 12 }}>
                <h3 style={{ margin: "0 0 6px" }}>🎯 Recommended for you</h3>
                <p className="muted" style={{ fontSize: ".85rem", marginTop: 0 }}>Focus on: <strong>{recs.concepts.join(", ")}</strong>.</p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {recs.topics.map((t) => (
                    <Link key={t.id} className="btn small secondary" href={`/learn/topic/${t.id}`}>
                      {t.subject?.title ? `${t.subject.title}: ` : ""}{t.title} →
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {visible.length === 0 ? (
              <div className="card"><p className="muted">Nothing here yet. Tap <strong>💬 Ask me</strong> anywhere to ask a doubt or a question.</p></div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {visible.map((m) => {
                  const isOpen = open === m.id;
                  const answered = (m.answers && m.answers.length > 0) || m.kind === "paper" || m.status === "answered";
                  return (
                    <div className="card" key={m.id} style={{ padding: isOpen ? 18 : 12 }}>
                      <div onClick={() => setOpen(isOpen ? null : m.id)} style={{ cursor: "pointer", display: "flex", gap: 10, alignItems: "baseline" }}>
                        <span>{m.kind === "paper" ? "📝" : "❓"}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, whiteSpace: isOpen ? "normal" : "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {m.title}
                          </div>
                          {!isOpen && (
                            <div className="muted" style={{ fontSize: ".8rem" }}>
                              {m.kind === "paper" && typeof m.score === "number" ? `Score ${m.score}/${m.max} · ` : ""}
                              {fmt(m.when)}
                              {labels[m.id] ? ` · 📁 ${labels[m.id]}` : ""}
                            </div>
                          )}
                        </div>
                        {!answered && <span className="badge">⏳</span>}
                      </div>

                      {isOpen && (
                        <div style={{ marginTop: 12 }}>
                          {m.kind === "paper" ? (
                            <>
                              {typeof m.score === "number" && <p className="grad" style={{ fontWeight: 800 }}>Score: {m.score}/{m.max}</p>}
                              <p className="muted" style={{ fontSize: ".82rem", marginBottom: 2 }}>Your answer:</p>
                              <p style={{ whiteSpace: "pre-wrap", marginTop: 0 }}>{m.yourAnswer}</p>
                              {m.feedback && (
                                <div style={{ paddingLeft: 12, borderLeft: "3px solid var(--accent)" }}>
                                  <p className="muted" style={{ fontSize: ".75rem", margin: 0 }}>📋 Examiner feedback</p>
                                  <p style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{m.feedback}</p>
                                </div>
                              )}
                              <PaperTools suggested={m.suggested} shareTitle="My CA paper — 121 CA Classes" shareText={m.shareText} />
                            </>
                          ) : (
                            <>
                              {(m.answers ?? []).map((a, j) => (
                                <div key={j} style={{ marginTop: 8, paddingLeft: 12, borderLeft: "3px solid var(--accent)" }}>
                                  <p className="muted" style={{ fontSize: ".75rem", margin: 0 }}>{a.kind === "reply" ? "💬 Reply from the team" : "🤖 Answer"}</p>
                                  <p style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{a.text}</p>
                                </div>
                              ))}
                              {(m.answers ?? []).length === 0 && <p className="muted" style={{ fontSize: ".82rem" }}>Sent to the team — reply coming here soon.</p>}
                              <div className="no-print" style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                                <form action={shareToCommunity} style={{ margin: 0 }}>
                                  <input type="hidden" name="text" value={m.shareText} />
                                  <button className="btn small secondary" type="submit">📢 Community</button>
                                </form>
                                <form action={shareToTelegram} style={{ margin: 0 }}>
                                  <input type="hidden" name="text" value={m.shareText} />
                                  <button className="btn small secondary" type="submit">✈️ Telegram</button>
                                </form>
                              </div>
                            </>
                          )}

                          {/* Move to folder */}
                          <div className="no-print" style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
                            <span className="muted" style={{ fontSize: ".78rem" }}>📁 Folder:</span>
                            <select value={labels[m.id] || ""} onChange={(e) => setLabel(m.id, e.target.value)} style={{ marginBottom: 0, maxWidth: 200 }}>
                              <option value="">— none —</option>
                              {customFolders.map((f) => <option key={f} value={f}>{f}</option>)}
                            </select>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
