"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { buildDayPlan, DEFAULT_CONFIG, type PlanSetup, type PlannerConfig, type SchedEntry } from "@/lib/plan";
import { savePlan, setRemind as setRemindAction } from "./actions";

export type PlanItem = { id: string; title: string; subject: string; subjectId?: string | null };
type Task = { id: string; text: string; due: string; done: boolean };
type DiaryEntry = { id: string; date: string; text: string };
type Setup = {
  source: "us" | "others"; classes: string; tests: string; examDate: string;
  selfStudyHours: string; daysOffPerWeek: string; holidays: string; extras: string;
  wantExtraRevision: boolean;
};

const STAGE_HEAD: Record<string, { label: string; bg: string; fg: string }> = {
  exhaustive: { label: "📚 Stage 1 — Exhaustive study (classes, homework, MCQ & descriptive tests · master important questions)", bg: "rgba(13,148,136,.10)", fg: "var(--accent)" },
  rev1: { label: "🔁 Stage 2 — First revision (starts after classes · 25% of study time · revision videos + revision questions)", bg: "rgba(59,130,246,.10)", fg: "#2563eb" },
  extra: { label: "⚡ Extra revision (optional · 15% of study time · revision videos at fast pace)", bg: "rgba(245,158,11,.12)", fg: "#b45309" },
  rev2: { label: "🔂 Stage 3 — Second revision (50% of first revision · your marked questions · ends ~5 days before exam)", bg: "rgba(236,72,153,.10)", fg: "#be185d" },
};

const LS_DONE = "planner_done";
const LS_TASKS = "planner_tasks";
const LS_DIARY = "planner_diary";

export default function Planner({
  items,
  signedIn,
  initial,
  config,
  durations,
  subjectMaster,
  subjectRev,
  testPerf = -1,
}: {
  items: PlanItem[];
  signedIn?: boolean;
  initial?: { setup: PlanSetup | null; schedule: SchedEntry[] | null; remind: boolean } | null;
  config?: Partial<PlannerConfig> | null;
  durations?: number[];
  subjectMaster?: Record<string, number>;
  subjectRev?: Record<string, number>;
  testPerf?: number;
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
    selfStudyHours: initial?.setup?.selfStudyHours ? String(initial.setup.selfStudyHours) : "3",
    daysOffPerWeek: initial?.setup?.daysOffPerWeek != null ? String(initial.setup.daysOffPerWeek) : "1",
    holidays: (initial?.setup?.holidays ?? []).join(", "),
    extras: (initial?.setup?.extras ?? []).join("\n"),
    wantExtraRevision: initial?.setup?.wantExtraRevision ?? false,
  });
  const [schedule, setSchedule] = useState<SchedEntry[]>(initial?.schedule ?? []);
  const [warning, setWarning] = useState("");
  const [remind, setRemindState] = useState<boolean>(initial?.remind ?? true);
  const [saving, startSave] = useTransition();
  const [savedMsg, setSavedMsg] = useState("");
  const cfg: PlannerConfig = { ...DEFAULT_CONFIG, ...(config ?? {}) };

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
      selfStudyHours: Number(setup.selfStudyHours) || 3,
      daysOffPerWeek: Number(setup.daysOffPerWeek) || 0,
      holidays: setup.holidays.split(",").map((s) => s.trim()).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)),
      extras: setup.extras.split("\n").map((s) => s.trim()).filter(Boolean),
      wantExtraRevision: setup.wantExtraRevision,
    };
  }

  function generate() {
    if (!setup.examDate) { alert("Please pick your exam date."); return; }
    const ps = resolvedSetup();
    const us = ps.source === "us";
    const titles = us ? items.map((i) => i.title) : [];
    const durs = us ? (durations ?? []) : [];
    const opts = us
      ? {
          classSubjects: items.map((i) => i.subject),
          classIds: items.map((i) => i.id),
          subjectMaster: subjectMaster ?? {},
          subjectRev: subjectRev ?? {},
        }
      : {};
    const { entries, warning: warn } = buildDayPlan(ps, cfg, titles, new Date(), durs, opts);
    setSchedule(entries);
    setWarning(warn ?? "");
    setSavedMsg("");
    startSave(async () => {
      const r = await savePlan(ps, entries, remind);
      setSavedMsg(r.ok ? "✅ Plan saved — we'll remind you each week." : "");
    });
  }

  // Group schedule entries by day — and fold in the student's dated to-dos.
  const byDay = useMemo(() => {
    const m = new Map<string, SchedEntry[]>();
    for (const e of schedule) { if (!m.has(e.iso)) m.set(e.iso, []); m.get(e.iso)!.push(e); }
    for (const t of tasks) {
      if (!t.due) continue;
      const d = new Date(t.due);
      const label = `✅ To-do: ${t.text}${t.done ? " (done)" : ""}`;
      const entry: SchedEntry = { iso: t.due, date: d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }), label };
      if (!m.has(t.due)) m.set(t.due, []);
      m.get(t.due)!.push(entry);
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [schedule, tasks]);

  // Pace (ahead / behind) per exhaustive day — schedule adherence + test
  // performance combined. Positive = ahead, negative = behind, in study-days.
  const paceByIso = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    let penalty = 0;
    if (testPerf >= 0) { if (testPerf < 50) penalty = 2; else if (testPerf < 65) penalty = 1; }
    const exh = schedule.filter((e) => e.stage === "exhaustive").sort((a, b) => (a.iso < b.iso ? -1 : 1));
    let expected = 0, doneC = 0;
    const map = new Map<string, number>();
    for (const e of exh) {
      expected++;
      const ids = e.topicIds ?? [];
      if (ids.length > 0 && ids.every((id) => done[id])) doneC++;
      if (e.iso <= today) map.set(e.iso, doneC - expected - penalty);
    }
    return map;
  }, [schedule, done, testPerf]);

  const todayIso = new Date().toISOString().slice(0, 10);
  function paceCell(e: SchedEntry) {
    if (e.stage !== "exhaustive" || e.iso > todayIso || !paceByIso.has(e.iso)) {
      return <span className="muted">—</span>;
    }
    const v = paceByIso.get(e.iso)!;
    if (v === 0) return <span style={{ color: "#16a34a", fontWeight: 600 }}>On track</span>;
    if (v > 0) return <span style={{ color: "#16a34a", fontWeight: 600 }}>+{v}d ahead</span>;
    return <span style={{ color: -v >= 2 ? "#dc2626" : "#d97706", fontWeight: 600 }}>{v}d behind</span>;
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
          <div>
            <label>Hours of <strong style={{ color: "var(--accent)" }}>self study</strong> per day</label>
            <input type="number" min={1} max={16} value={setup.selfStudyHours} onChange={(e) => setSetup({ ...setup, selfStudyHours: e.target.value })} />
          </div>
          <div>
            <label>Days off per week</label>
            <select value={setup.daysOffPerWeek} onChange={(e) => setSetup({ ...setup, daysOffPerWeek: e.target.value })}>
              <option value="0">None</option>
              <option value="1">Sundays</option>
              <option value="2">Sat &amp; Sun</option>
            </select>
          </div>
        </div>
        <label style={{ marginTop: 8 }}>Holidays / days you can&apos;t study (dates, comma-separated)</label>
        <input value={setup.holidays} onChange={(e) => setSetup({ ...setup, holidays: e.target.value })} placeholder="2026-07-15, 2026-08-20" />
        <label style={{ marginTop: 8 }}>Extra work to add (one per line — optionally <code>YYYY-MM-DD | task</code>)</label>
        <textarea rows={2} value={setup.extras} onChange={(e) => setSetup({ ...setup, extras: e.target.value })} placeholder={"2026-07-10 | Revise Costing formulas\nSolve last 3 RTPs"} />
        <p className="muted" style={{ fontSize: ".8rem", marginTop: 6 }}>
          We fit your classes into your <strong style={{ color: "var(--accent)" }}>self study</strong> hours each day. If they don&apos;t fit before the exam, we&apos;ll warn you.
        </p>
        <label className="remember" style={{ marginTop: 10 }}>
          <input type="checkbox" checked={setup.wantExtraRevision} onChange={(e) => setSetup({ ...setup, wantExtraRevision: e.target.checked })} /> ⚡ Add one extra (fast) revision — between first &amp; second revision
        </label>
        <label className="remember" style={{ marginTop: 6 }}>
          <input type="checkbox" checked={remind} onChange={(e) => toggleRemind(e.target.checked)} /> 🔔 Remind me each week (Telegram/email)
        </label>
        <button className="btn" type="button" onClick={generate} disabled={saving} style={{ marginTop: 6 }}>
          {saving ? "Saving…" : "Generate my day-by-day plan →"}
        </button>
        {savedMsg && <p className="muted" style={{ fontSize: ".82rem", marginTop: 8 }}>{savedMsg}</p>}
        {setup.source === "us" && <p className="muted" style={{ fontSize: ".8rem", marginTop: 8 }}>We&apos;ll schedule our {items.length} published topics as your classes.</p>}
      </div>

      {warning && (
        <div className="notice err" style={{ lineHeight: 1.6 }}>{warning}</div>
      )}

      {/* Generated day-by-day plan — table with the 3 stages */}
      {byDay.length > 0 && (() => {
        const rows: { iso: string; date: string; e: SchedEntry }[] = [];
        for (const [, entries] of byDay) for (const e of entries) rows.push({ iso: e.iso, date: e.date, e });
        let lastStage = "";
        return (
          <div className="card" style={{ overflowX: "auto" }}>
            <h3 style={{ margin: "0 0 4px" }}>📅 Your day-by-day plan</h3>
            <p className="muted" style={{ fontSize: ".8rem", marginTop: 0, marginBottom: 10 }}>
              Tick classes off in the syllabus checklist below — the <strong>Pace</strong> column updates to show how far ahead or behind you are.
            </p>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".85rem", minWidth: 640 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--muted, #888)", borderBottom: "1px solid var(--border, #ddd)" }}>
                  <th style={{ padding: "6px 8px", fontWeight: 600 }}>Date</th>
                  <th style={{ padding: "6px 8px", fontWeight: 600 }}>Topic / class</th>
                  <th style={{ padding: "6px 8px", fontWeight: 600 }}>Hrs</th>
                  <th style={{ padding: "6px 8px", fontWeight: 600 }}>Test</th>
                  <th style={{ padding: "6px 8px", fontWeight: 600 }}>Questions to do</th>
                  <th style={{ padding: "6px 8px", fontWeight: 600 }}>Pace</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ iso, date, e }, idx) => {
                  const header = e.stage && e.stage !== lastStage ? STAGE_HEAD[e.stage] : null;
                  if (e.stage) lastStage = e.stage;
                  return (
                    <FragmentRow
                      key={idx}
                      header={header}
                      date={date}
                      e={e}
                      isToday={iso === todayIso}
                      pace={paceCell(e)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })()}

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

function FragmentRow({
  header, date, e, isToday, pace,
}: {
  header: { label: string; bg: string; fg: string } | null;
  date: string; e: SchedEntry; isToday: boolean; pace: ReactNode;
}) {
  const td = { padding: "7px 8px", borderBottom: "1px solid var(--border, #eee)", verticalAlign: "top" as const };
  return (
    <>
      {header && (
        <tr>
          <td colSpan={6} style={{ padding: "8px 8px", background: header.bg, color: header.fg, fontWeight: 600 }}>
            {header.label}
          </td>
        </tr>
      )}
      <tr style={isToday ? { background: "rgba(13,148,136,.08)" } : undefined}>
        <td style={{ ...td, whiteSpace: "nowrap", fontWeight: isToday ? 700 : 400 }}>
          {date}{isToday ? " · today" : ""}
        </td>
        <td style={{ ...td, fontWeight: e.mock ? 700 : 400 }}>{e.topic ?? e.label}</td>
        <td style={td}>{e.hours ? `${e.hours}` : "—"}</td>
        <td style={td}>{e.test ? <span style={{ background: "var(--bg-soft)", padding: "2px 7px", borderRadius: 6, whiteSpace: "nowrap" }}>{e.test}</span> : "—"}</td>
        <td style={td}>{e.questions || "—"}</td>
        <td style={td}>{pace}</td>
      </tr>
    </>
  );
}
