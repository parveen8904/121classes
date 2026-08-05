import Link from "next/link";
import AdminHero from "../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import { createServiceClient } from "@/lib/supabase/service";
import { assertArea } from "@/lib/adminAccess";
import type { Lesson } from "@/lib/aiLessons";
import { addRule, addCorrection, setLessonActive, deleteLesson, tryQuestion } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Teach the AI — Admin" };

// Where the AI is taught, rather than argued with.
//
// Rewording one reply helps one student; the next one asks the same thing and
// gets the same mistake back. What is written here goes in front of the model on
// EVERY channel — email, Telegram, WhatsApp, Discord, the study groups and the
// website — so a thing corrected once stays corrected.

const SCOPES: [string, string][] = [
  ["all", "Everywhere"],
  ["doubt", "Website & email doubts"],
  ["group_doubt", "Study groups"],
];

const IST = (s: string) =>
  new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

type LastTry = {
  question: string; scope: string; answer: string;
  fired: { kind: string; guidance: string }[]; at: string;
};

export default async function AiTrainingPage(props: {
  searchParams: Promise<{ saved?: string; err?: string; taught?: string; tried?: string }>;
}) {
  await assertArea(null);
  const sp = await props.searchParams;

  const svc = createServiceClient();
  const [{ data: lessons }, { data: setting }] = await Promise.all([
    svc.from("ai_lessons")
      .select("id, kind, scope, trigger, guidance, active, was_answered, created_at")
      .order("created_at", { ascending: false })
      .limit(300),
    svc.from("site_settings").select("value").eq("key", "ai_training_last_try").maybeSingle(),
  ]);

  const all = (lessons ?? []) as Lesson[];
  const rules = all.filter((l) => l.kind === "rule");
  const corrections = all.filter((l) => l.kind === "correction");

  let lastTry: LastTry | null = null;
  try { lastTry = setting?.value ? (JSON.parse(setting.value as string) as LastTry) : null; } catch { lastTry = null; }

  return (
    <section className="container" style={{ paddingTop: 24, paddingBottom: 60, maxWidth: 880 }}>
      <AdminHero
        badge="🎓 Teach the AI"
        title="Correct it once, and it stays corrected"
        subtitle="Rewriting a reply helps one student. What you write here goes in front of the AI on every channel — email, Telegram, WhatsApp, the study groups and the website — before it answers anybody."
        back={{ href: "/admin", label: "Admin" }}
      />

      {sp.err && <div className="notice err" style={{ marginTop: 16 }}>⚠️ {sp.err}</div>}
      {sp.saved && <div className="notice ok" style={{ marginTop: 16 }}>✅ Saved. It applies to the very next answer.</div>}
      {sp.taught && <div className="notice ok" style={{ marginTop: 16 }}>✅ Taught. The next similar question gets your answer.</div>}

      {/* ── 1. A standing rule ─────────────────────────────────────────────── */}
      <h2 className="admin-section-title" style={{ marginTop: 28 }}>1️⃣ A rule it must always follow</h2>
      <p className="muted" style={{ fontSize: ".88rem", margin: "4px 0 10px", lineHeight: 1.6 }}>
        Applied to every answer, whatever the question. Write it as an instruction, the way you would tell a new
        member of staff. Short and absolute works best — <em>&ldquo;Never state a price. Say a colleague will
        confirm.&rdquo;</em>
      </p>
      <form action={addRule} className="card" style={{ display: "grid", gap: 10 }}>
        <textarea name="guidance" rows={2} required placeholder="Never tell a student what they previously paid. Pass it to a person." />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select name="scope" defaultValue="all" style={{ maxWidth: 260 }}>
            {SCOPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <SubmitButton className="btn">➕ Add the rule</SubmitButton>
        </div>
      </form>

      {/* ── 2. A correction ────────────────────────────────────────────────── */}
      <h2 className="admin-section-title" style={{ marginTop: 30 }}>2️⃣ It answered something badly</h2>
      <p className="muted" style={{ fontSize: ".88rem", margin: "4px 0 10px", lineHeight: 1.6 }}>
        Paste the question it got wrong and write what it should have said. When a student asks something similar,
        your answer is put in front of it. This is the one that actually teaches — you can also do it straight from
        the <Link href="/admin/doubt-log">doubt report</Link>, beside the answer that was wrong.
      </p>
      <form action={addCorrection} className="card" style={{ display: "grid", gap: 10 }}>
        <div>
          <label>The question a student asked</label>
          <textarea name="trigger" rows={2} required placeholder="Is this free for everyone, or do I still need the ₹11,500 course I bought?" />
        </div>
        <div>
          <label>What it should have said</label>
          <textarea name="guidance" rows={3} required placeholder="Do not answer this. Say that an earlier Aldine purchase is checked by hand and a colleague will confirm today." />
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <select name="scope" defaultValue="all" style={{ maxWidth: 260 }}>
            {SCOPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <SubmitButton className="btn">🎓 Teach it</SubmitButton>
        </div>
      </form>

      {/* ── 3. Try it ──────────────────────────────────────────────────────── */}
      <div id="try" style={{ scrollMarginTop: 90 }}>
        <h2 className="admin-section-title" style={{ marginTop: 30 }}>3️⃣ Try it before a student does</h2>
        <p className="muted" style={{ fontSize: ".88rem", margin: "4px 0 10px", lineHeight: 1.6 }}>
          Ask it the question that went wrong and see what comes back now. Nothing is sent to anybody.
        </p>
        <form action={tryQuestion} className="card" style={{ display: "grid", gap: 10 }}>
          <textarea name="question" rows={2} required placeholder="Type the question exactly as a student would…" />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <select name="scope" defaultValue="doubt" style={{ maxWidth: 260 }}>
              {SCOPES.filter(([v]) => v !== "all").map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <SubmitButton className="btn secondary">▶ Ask it</SubmitButton>
          </div>
        </form>

        {lastTry && (
          <div className="card" style={{ marginTop: 12 }}>
            <p className="muted" style={{ fontSize: ".8rem", margin: 0 }}>Last try · {IST(lastTry.at)}</p>
            <p style={{ margin: "6px 0 0" }}><strong>Q.</strong> {lastTry.question}</p>
            <div style={{ background: "var(--bg-soft)", borderRadius: 8, padding: "10px 12px", marginTop: 8, whiteSpace: "pre-wrap", fontSize: ".9rem", lineHeight: 1.6 }}>
              {lastTry.answer}
            </div>
            <p className="muted" style={{ fontSize: ".82rem", margin: "8px 0 0" }}>
              {lastTry.fired.length > 0
                ? `📌 ${lastTry.fired.length} of your lesson${lastTry.fired.length === 1 ? "" : "s"} was applied: ${lastTry.fired.map((f) => f.guidance.slice(0, 70)).join(" · ")}`
                : "📌 None of your lessons matched this question — if one should have, word its question more like this one."}
            </p>
          </div>
        )}
      </div>

      {/* ── What has been taught ───────────────────────────────────────────── */}
      <h2 className="admin-section-title" style={{ marginTop: 32 }}>📚 What it has been taught</h2>
      {all.length === 0 ? (
        <div className="card"><p className="muted" style={{ margin: 0 }}>Nothing yet. The first rule above is a good place to start.</p></div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {[["Rules — always applied", rules], ["Corrections — applied to a similar question", corrections]].map(
            ([title, list]) => {
              const items = list as Lesson[];
              if (items.length === 0) return null;
              return (
                <div key={title as string}>
                  <h3 style={{ fontSize: ".95rem", margin: "10px 0 6px" }}>{title as string} ({items.length})</h3>
                  <div style={{ display: "grid", gap: 8 }}>
                    {items.map((l) => (
                      <div className="card" key={l.id} style={{ padding: "10px 14px", opacity: l.active ? 1 : 0.55 }}>
                        {l.trigger && (
                          <p className="muted" style={{ margin: 0, fontSize: ".82rem" }}>
                            When asked: &ldquo;{l.trigger.slice(0, 180)}&rdquo;
                          </p>
                        )}
                        <p style={{ margin: "4px 0 0", fontSize: ".9rem", lineHeight: 1.6 }}>{l.guidance}</p>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
                          <span className="badge">{SCOPES.find(([v]) => v === l.scope)?.[1] ?? l.scope}</span>
                          <span className="muted" style={{ fontSize: ".78rem" }}>{IST(l.created_at)}</span>
                          {!l.active && <span style={{ color: "#b45309", fontWeight: 700, fontSize: ".8rem" }}>paused</span>}
                          <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                            <form action={setLessonActive}>
                              <input type="hidden" name="id" value={l.id} />
                              <input type="hidden" name="active" value={l.active ? "0" : "1"} />
                              <SubmitButton className="btn small secondary">{l.active ? "Pause" : "Use again"}</SubmitButton>
                            </form>
                            <form action={deleteLesson}>
                              <input type="hidden" name="id" value={l.id} />
                              <SubmitButton className="btn small secondary">Delete</SubmitButton>
                            </form>
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            },
          )}
        </div>
      )}

      <p className="muted" style={{ fontSize: ".82rem", marginTop: 26 }}>
        A lesson applies to the very next answer — there is nothing to deploy. Keep them few and firm: a long list of
        half-relevant instructions makes the AI worse, not better.
      </p>
    </section>
  );
}
