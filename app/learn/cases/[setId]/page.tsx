import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

// List of case studies in a set: number, title, question count, my best score.
export default async function CaseSetPage({ params }: { params: { setId: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/learn/cases/${params.setId}`);

  const svc = createServiceClient();
  const [{ data: set }, { data: me }] = await Promise.all([
    svc.from("case_sets").select("id, title, subject_id, status, is_published, subjects(title, course_id)").eq("id", params.setId).maybeSingle(),
    supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
  ]);
  const isStaff = me?.role === "admin" || me?.role === "faculty";
  if (!set || set.status !== "ready" || (!set.is_published && !isStaff)) notFound();

  const [{ data: cases }, { data: myAttempts }] = await Promise.all([
    svc.from("case_studies").select("id, seq, title").eq("set_id", set.id).order("seq"),
    svc.from("case_attempts").select("case_id, score, total").eq("student_id", user.id),
  ]);
  const caseIds = (cases ?? []).map((c) => c.id as string);
  const qCounts = new Map<string, number>();
  if (caseIds.length) {
    const { data: qRows } = await svc.from("case_questions").select("case_id").in("case_id", caseIds);
    for (const r of qRows ?? []) qCounts.set(r.case_id as string, (qCounts.get(r.case_id as string) ?? 0) + 1);
  }
  const best = new Map<string, { score: number; total: number }>();
  for (const a of (myAttempts ?? []) as { case_id: string; score: number; total: number }[]) {
    const b = best.get(a.case_id);
    if (!b || a.score > b.score) best.set(a.case_id, { score: a.score, total: a.total });
  }
  const subj = (set as { subjects?: { title?: string; course_id?: string } | null }).subjects;

  return (
    <main>
      <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
        <p className="crumb">
          <Link href={subj?.course_id ? `/learn/${subj.course_id}` : "/dashboard"}>← {subj?.title ?? "Subject"}</Link>
        </p>
        <div className="learn-hero">
          <span className="badge">🧩 Case studies</span>
          <h1>{set.title}</h1>
          <p className="meta">
            {(cases ?? []).length} case studies · read the scenario, answer its MCQs, and get the right
            answers with reasons immediately.
          </p>
        </div>
        <div style={{ display: "grid", gap: 8, marginTop: 18 }}>
          {(cases ?? []).map((c) => {
            const b = best.get(c.id as string);
            const n = qCounts.get(c.id as string) ?? 0;
            return (
              <Link key={c.id} href={`/learn/cases/${set.id}/${c.id}`} className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, color: "var(--text)" }}>
                <span style={{ fontWeight: 700 }}>{c.title || `Case ${c.seq}`}</span>
                <span style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                  <span className="muted" style={{ fontSize: ".85rem" }}>{n} MCQ{n === 1 ? "" : "s"}</span>
                  {b && <span style={{ display: "block", fontSize: ".85rem", fontWeight: 700, color: b.score === b.total ? "#16a34a" : "var(--accent)" }}>✓ Best: {b.score}/{b.total}</span>}
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </main>
  );
}
