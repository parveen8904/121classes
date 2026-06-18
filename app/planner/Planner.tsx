"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { buildSchedule, type PlanSetup, type SchedEntry } from "@/lib/plan";
import { savePlan, setRemind as setRemindAction } from "./actions";

export type PlanItem = { id: string; title: string; subject: string };
type Task = { id: string; text: string; due: string; done: boolean };
type DiaryEntry = { id: string; date: string; text: string };
type Setup = { source: "us" | "others"; classes: string; tests: string; examDate: string };

const LS_DONE = "planner_done";
const LS_TASKS = "planner_tasks";
const LS_DIARY = "planner_diary";

export default function Planner({
  items,
  signedIn,
  initial,
}: {
  items: PlanItem[];
  signedIn?: boolean;
  initial?: { setup: PlanSetup | null; schedule: SchedEntry[] | null; remind: boolean } | null;
}) {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [tasks, setTasks] = useState<Task[]>([]);
  const [diary, setDiary] = useState<DiaryEntry[]>([]);
  const [taskText, setTaskText] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [note, setNote] = useState("");
  const [setup, setSetup] = useState<Setup>({
    source: initial?.setup?.source ?? "us",
    classes: initial?.setup?.classes ? String(initial.setup.classes) : "",
    tests: initial?.setup?.tests ? String(initial.setup.tests) : "",
    examDate: initial?.setup?.examDate ?? "",
  });
  const [schedule, setSchedule] = useState<SchedEntry[]>(initial?.schedule ?? []);
  const [remind, setRemindState] = useState<boolean>(initial?.remind ?? true);
  const [saving, startSave] = useTransition();
  const [savedMsg, setSavedMsg] = useState("");

  useEffect(() => {
    try {
      setDone(JSON.parse(localStorage.getItem(LS_DONE) || "{}"));
      setTasks(JSON.parse(localStorage.getItem(LS_TASKS) || "[]"));
      setDiary(JSON.parse(localStorage.getItem(LS_DIARY) || "[]"));
    } catch {}
  }, []);

  function resolvedSetup(): PlanSetup {
    return {
      source: setup.source,
      classes: Number(setup.classes) || (setup.source === "us" ? items.length : 0),
      tests: Number(setup.tests) || 0,
      examDate: setup.examDate,
    };
  }

  function generate() {
    if (!setup.examDate) { alert("Please pick your exam date."); return; }
    const ps = resolvedSetup();
    const sched = buildSchedule(ps);
    setSchedule(sched);
    setSavedMsg("");
    startSave(async () => {
      const r = await savePlan(ps, remind);
      setSavedMsg(r.ok ? "✅ Plan saved — we'll remind you each week." : "");
    });
  }

  function toggleRemind(v: boolean) {
    setRemindState(v);
    startSave(async () => { await setRemindAction(v); });
  }

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
      {/* Intake — build a dated plan */}
      <div className="card" style={{ borderColor: "var(--accent)" }}>
        <h3 style={{ margin: "0 0 8px" }}>🎯 Build my plan</h3>
        <label>Are you taking classes with us, or elsewhere?</label>
        <div style={{ display: "flex", gap: 16, margin: "4px 0 10px" }}>
          <label className="remember" style={{ margin: 0 }}>
            <input type="radio" name="src" checked={setup.source === "us"} onChange={() => setSetup({ ...setup, source: "us" })} /> With 121 CA Classes
          </label>
          <label className="remember" style={{ margin: 0 }}>
            <input type="radio" name="src" checked={setup.source === "others"} onChange={() => setSetup({ ...setup, source: "others" })} /> Elsewhere
          </label>
        </div>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr 1fr" }}>
          {setup.source === "others" && (
            <>
              <div><label>Total classes to do</label><input type="number" value={setup.classes} onChange={(e) => setSetup({ ...setup, classes: e.target.value })} placeholder="e.g. 120" /></div>
              <div><label>Total tests to do</label><input type="number" value={setup.tests} onChange={(e) => setSetup({ ...setup, tests: e.target.value })} placeholder="e.g. 24" /></div>
            </>
          )}
          <div><label>Your exam date</label><input type="date" value={setup.examDate} onChange={(e) => setSetup({ ...setup, examDate: e.target.value })} /></div>
        </div>
        <label className="remember" style={{ marginTop: 10 }}>
          <input type="checkbox" checked={remind} onChange={(e) => toggleRemind(e.target.checked)} /> 🔔 Remind me each week (Telegram/email)
        </label>
        <button className="btn" type="button" onClick={generate} disabled={saving} style={{ marginTop: 6 }}>
          {saving ? "Saving…" : "Generate my plan →"}
        </button>
        {savedMsg && <p className="muted" style={{ fontSize: ".82rem", marginTop: 8 }}>{savedMsg}</p>}
        {setup.source === "us" && <p className="muted" style={{ fontSize: ".8rem", marginTop: 8 }}>We&apos;ll use our {items.length} published topics as your class count.</p>}
      </div>

      {/* Generated schedule */}
      {schedule.length > 0 && (
        <div className="card">
          <h3 style={{ margin: "0 0 8px" }}>📅 Your week-by-week plan</h3>
          <div style={{ display: "grid", gap: 6 }}>
            {schedule.map((s, i) => (
              <div key={i} style={{ display: "flex", gap: 10, padding: "6px 10px", borderRadius: 8, background: s.mock ? "rgba(13,148,136,.12)" : "transparent", fontWeight: s.mock ? 700 : 400 }}>
                <span className="muted" style={{ minWidth: 110, fontSize: ".82rem" }}>{s.date}</span>
                <span>{s.label}</span>
              </div>
            ))}
          </div>
          <p className="muted" style={{ fontSize: ".78rem", marginTop: 10 }}>
            {signedIn ? "Tick topics off below as you go." : "Log in to also track your topic checklist and get reminders."}
          </p>
        </div>
      )}

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
