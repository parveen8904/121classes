"use client";

import { useEffect, useMemo, useState } from "react";

export type PlanItem = { id: string; title: string; subject: string };
type Task = { id: string; text: string; due: string; done: boolean };
type DiaryEntry = { id: string; date: string; text: string };

const LS_DONE = "planner_done";
const LS_TASKS = "planner_tasks";
const LS_DIARY = "planner_diary";

export default function Planner({ items }: { items: PlanItem[] }) {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [tasks, setTasks] = useState<Task[]>([]);
  const [diary, setDiary] = useState<DiaryEntry[]>([]);
  const [taskText, setTaskText] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    try {
      setDone(JSON.parse(localStorage.getItem(LS_DONE) || "{}"));
      setTasks(JSON.parse(localStorage.getItem(LS_TASKS) || "[]"));
      setDiary(JSON.parse(localStorage.getItem(LS_DIARY) || "[]"));
    } catch {}
  }, []);

  const saveDone = (d: Record<string, boolean>) => { setDone(d); try { localStorage.setItem(LS_DONE, JSON.stringify(d)); } catch {} };
  const saveTasks = (t: Task[]) => { setTasks(t); try { localStorage.setItem(LS_TASKS, JSON.stringify(t)); } catch {} };
  const saveDiary = (d: DiaryEntry[]) => { setDiary(d); try { localStorage.setItem(LS_DIARY, JSON.stringify(d)); } catch {} };

  const rid = () => Math.random().toString(36).slice(2);

  const bySubject = useMemo(() => {
    const m = new Map<string, PlanItem[]>();
    for (const it of items) { if (!m.has(it.subject)) m.set(it.subject, []); m.get(it.subject)!.push(it); }
    return [...m.entries()];
  }, [items]);

  const totalDone = items.filter((i) => done[i.id]).length;
  const pct = items.length ? Math.round((totalDone / items.length) * 100) : 0;
  const todaysFocus = items.filter((i) => !done[i.id]).slice(0, 3);
  const today = new Date().toISOString().slice(0, 10);
  const openTasks = tasks.filter((t) => !t.done);

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {/* Progress + today's focus */}
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap" }}>
          <strong>Syllabus progress</strong>
          <span className="muted">{totalDone}/{items.length} topics · {pct}%</span>
        </div>
        <div style={{ height: 10, background: "var(--bg-soft)", borderRadius: 999, marginTop: 8, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)" }} />
        </div>
        {todaysFocus.length > 0 && (
          <p className="muted" style={{ fontSize: ".88rem", marginTop: 12 }}>
            🎯 <strong>Today&apos;s focus:</strong> {todaysFocus.map((t) => t.title).join(" · ")}
          </p>
        )}
      </div>

      {/* My tasks */}
      <div className="card">
        <h3 style={{ margin: "0 0 8px" }}>✅ My to-dos</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={taskText} onChange={(e) => setTaskText(e.target.value)} placeholder="e.g. Revise AS 24, attempt 10 MCQs" style={{ flex: 1, minWidth: 180, marginBottom: 0 }} />
          <input type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} style={{ marginBottom: 0 }} />
          <button className="btn small" type="button" onClick={() => { if (taskText.trim()) { saveTasks([{ id: rid(), text: taskText.trim(), due: taskDue, done: false }, ...tasks]); setTaskText(""); setTaskDue(""); } }}>Add</button>
        </div>
        <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
          {openTasks.length === 0 && <p className="muted" style={{ fontSize: ".85rem" }}>No pending to-dos. Add one above.</p>}
          {tasks.map((t) => (
            <label key={t.id} style={{ display: "flex", gap: 8, alignItems: "center", opacity: t.done ? 0.5 : 1 }}>
              <input type="checkbox" checked={t.done} onChange={() => saveTasks(tasks.map((x) => x.id === t.id ? { ...x, done: !x.done } : x))} style={{ width: "auto", margin: 0 }} />
              <span style={{ textDecoration: t.done ? "line-through" : "none" }}>{t.text}</span>
              {t.due && <span className="muted" style={{ fontSize: ".75rem", color: !t.done && t.due < today ? "#ef4444" : undefined }}>· {t.due}{!t.done && t.due < today ? " (overdue)" : ""}</span>}
              <button type="button" onClick={() => saveTasks(tasks.filter((x) => x.id !== t.id))} className="muted" style={{ marginLeft: "auto", border: "none", background: "none", cursor: "pointer" }}>✕</button>
            </label>
          ))}
        </div>
      </div>

      {/* Syllabus checklist */}
      <div className="card">
        <h3 style={{ margin: "0 0 8px" }}>📚 Syllabus checklist</h3>
        {bySubject.length === 0 && <p className="muted">No topics published yet.</p>}
        {bySubject.map(([subject, list]) => (
          <details key={subject} style={{ marginTop: 8 }}>
            <summary className="btn small secondary as-btn">
              {subject} — {list.filter((i) => done[i.id]).length}/{list.length}
            </summary>
            <div style={{ display: "grid", gap: 6, marginTop: 8, paddingLeft: 6 }}>
              {list.map((i) => (
                <label key={i.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="checkbox" checked={!!done[i.id]} onChange={() => saveDone({ ...done, [i.id]: !done[i.id] })} style={{ width: "auto", margin: 0 }} />
                  <span style={{ textDecoration: done[i.id] ? "line-through" : "none", opacity: done[i.id] ? 0.6 : 1 }}>{i.title}</span>
                </label>
              ))}
            </div>
          </details>
        ))}
      </div>

      {/* Diary */}
      <div className="card">
        <h3 style={{ margin: "0 0 8px" }}>📔 Daily diary</h3>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="What did you study today? How did it go?" />
        <button className="btn small" type="button" onClick={() => { if (note.trim()) { saveDiary([{ id: rid(), date: today, text: note.trim() }, ...diary]); setNote(""); } }}>Save entry</button>
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          {diary.map((d) => (
            <div key={d.id} style={{ borderLeft: "3px solid var(--accent)", paddingLeft: 10 }}>
              <p className="muted" style={{ fontSize: ".75rem", margin: 0 }}>{d.date}
                <button type="button" onClick={() => saveDiary(diary.filter((x) => x.id !== d.id))} className="muted" style={{ marginLeft: 8, border: "none", background: "none", cursor: "pointer" }}>✕</button>
              </p>
              <p style={{ margin: "2px 0 0", whiteSpace: "pre-wrap" }}>{d.text}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="muted" style={{ fontSize: ".78rem" }}>Your planner, to-dos and diary are saved on this device.</p>
    </div>
  );
}
