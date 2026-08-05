import { assertArea } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import SubmitButton from "@/app/components/SubmitButton";
import AnswerKey from "@/app/components/AnswerKey";
import AdminHero from "../_components/AdminHero";
import { draftOne, createSet, approvePaper, unapprovePaper, savePaper } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mock test papers — Admin" };

type Paper = {
  id: string; course: string; subject: string; attempt_label: string; paper_no: number;
  title: string; total_marks: number; duration_min: number;
  questions_md: string | null; answers_md: string | null;
  status: string; error: string | null; generated_at: string | null;
};

const LABEL: Record<string, { text: string; colour: string }> = {
  queued: { text: "⏳ Not drafted yet", colour: "var(--muted)" },
  drafting: { text: "✍️ Being drafted", colour: "#b45309" },
  drafted: { text: "📄 Drafted — read it", colour: "#2563eb" },
  approved: { text: "✅ Live for students", colour: "#16a34a" },
  failed: { text: "❌ Failed", colour: "#b91c1c" },
};

// Full mock papers, drafted then approved.
//
// The same rule as the answer keys: a paper reaches a student only when CA
// Parveen Sharma has read it and approved it. His name is on every question,
// and a wrong figure in a mock paper is worse than no mock paper — a student
// spends three hours on it and learns the wrong thing.
export default async function MockPapersPage(props: {
  searchParams: Promise<{ made?: string; drafted?: string; approved?: string; pulled?: string; saved?: string; err?: string }>;
}) {
  await assertArea(null);
  const searchParams = await props.searchParams;
  const svc = createServiceClient();
  const { data } = await svc.from("mock_papers").select("*").order("course").order("paper_no");
  const papers = (data ?? []) as Paper[];

  return (
    <section className="container" style={{ paddingTop: 24, paddingBottom: 60, maxWidth: 960 }}>
      <AdminHero
        badge="📄 Mock test papers"
        title="Full 100-mark papers, in the ICAI pattern"
        subtitle="30 marks of case-scenario MCQs and 70 marks descriptive, drafted from the pattern of past exam questions. Nothing reaches a student until you approve it."
        back={{ href: "/admin", label: "Admin" }}
      />

      {searchParams.made && <div className="notice ok" style={{ marginTop: 16 }}>✅ {searchParams.made} paper slot(s) created.</div>}
      {searchParams.drafted && <div className="notice ok" style={{ marginTop: 16 }}>✅ Drafted. Read it below before approving.</div>}
      {searchParams.approved && <div className="notice ok" style={{ marginTop: 16 }}>✅ Approved — it is live on the mock tests page.</div>}
      {searchParams.pulled && <div className="notice ok" style={{ marginTop: 16 }}>Taken off the site. Students can no longer open it.</div>}
      {searchParams.saved && <div className="notice ok" style={{ marginTop: 16 }}>✅ Saved.</div>}
      {searchParams.err && <div className="notice err" style={{ marginTop: 16 }}>❌ {searchParams.err}</div>}

      {papers.length === 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <strong>Nothing here yet</strong>
          <p className="muted" style={{ fontSize: ".88rem", margin: "4px 0 10px" }}>
            Create the three CA Intermediate — Advanced Accounting papers for the September 2026 attempt, then draft
            them one at a time.
          </p>
          <form action={createSet}>
            <SubmitButton className="btn" savedLabel="Created">➕ Create the September 2026 set</SubmitButton>
          </form>
        </div>
      )}

      <div style={{ display: "grid", gap: 14, marginTop: 16 }}>
        {papers.map((p) => {
          const st = LABEL[p.status] ?? LABEL.queued;
          return (
            <div className="card" key={p.id} style={{ borderLeft: `4px solid ${st.colour}` }}>
              <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <strong style={{ fontSize: "1.02rem" }}>Paper {p.paper_no} — {p.course}, {p.subject}</strong>
                <span style={{ color: st.colour, fontWeight: 700, fontSize: ".82rem" }}>{st.text}</span>
                <span className="muted" style={{ fontSize: ".8rem", marginLeft: "auto" }}>
                  {p.attempt_label} · {p.total_marks} marks · {p.duration_min} min
                </span>
              </div>
              {p.error && <p className="notice err" style={{ fontSize: ".82rem", marginTop: 8 }}>{p.error}</p>}

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                <form action={draftOne}>
                  <input type="hidden" name="id" value={p.id} />
                  <SubmitButton className="btn small secondary" savedLabel="Drafting…">
                    {p.questions_md ? "🔄 Draft it again" : "✍️ Draft this paper"}
                  </SubmitButton>
                </form>
                {p.status === "drafted" && (
                  <form action={approvePaper}>
                    <input type="hidden" name="id" value={p.id} />
                    <SubmitButton className="btn small" savedLabel="Approved">✅ Approve &amp; publish</SubmitButton>
                  </form>
                )}
                {p.status === "approved" && (
                  <form action={unapprovePaper}>
                    <input type="hidden" name="id" value={p.id} />
                    <SubmitButton className="btn small secondary" savedLabel="Pulled">↩︎ Take it off the site</SubmitButton>
                  </form>
                )}
              </div>

              {p.questions_md && (
                <>
                  <details className="card" style={{ marginTop: 12, padding: 12 }}>
                    <summary style={{ cursor: "pointer", fontWeight: 700 }}>📄 The question paper</summary>
                    <AnswerKey text={p.questions_md} size=".76rem" />
                  </details>
                  {p.answers_md && (
                    <details className="card" style={{ marginTop: 8, padding: 12 }}>
                      <summary style={{ cursor: "pointer", fontWeight: 700 }}>✅ The suggested answers</summary>
                      <AnswerKey text={p.answers_md} size=".76rem" />
                    </details>
                  )}
                  <details style={{ marginTop: 8 }}>
                    <summary className="btn as-btn small secondary" style={{ cursor: "pointer" }}>✏️ Correct it by hand</summary>
                    <form action={savePaper} style={{ marginTop: 10 }}>
                      <input type="hidden" name="id" value={p.id} />
                      <label style={{ fontSize: ".82rem" }}>Question paper</label>
                      <textarea name="questions_md" rows={12} defaultValue={p.questions_md ?? ""} style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: ".78rem" }} />
                      <label style={{ fontSize: ".82rem", marginTop: 8, display: "block" }}>Suggested answers</label>
                      <textarea name="answers_md" rows={12} defaultValue={p.answers_md ?? ""} style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: ".78rem" }} />
                      <SubmitButton className="btn small" savedLabel="Saved">💾 Save</SubmitButton>
                    </form>
                  </details>
                </>
              )}
            </div>
          );
        })}
      </div>

      {papers.length > 0 && (
        <form action={createSet} style={{ marginTop: 16 }}>
          <SubmitButton className="btn small secondary" savedLabel="Checked">➕ Make sure the September 2026 set exists</SubmitButton>
        </form>
      )}
    </section>
  );
}
