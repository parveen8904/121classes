import Link from "next/link";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import TryCasePlayer from "./TryCasePlayer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Try a free CA case scenario — CA Parveen Sharma" };

// The reward page of the verified-lead funnel: one REAL case scenario with its
// MCQs, playable without an account — plus any free sample PDFs the admin has
// marked. Reachable only with a verified lead_verifications id (?v=).
export default async function TryCasesPage(props: { searchParams: Promise<{ v?: string }> }) {
  const searchParams = await props.searchParams;
  const v = (searchParams.v ?? "").trim();
  if (!/^[0-9a-f-]{36}$/.test(v)) redirect("/free-planner?src=try");

  const svc = createServiceClient();
  const { data: verif } = await svc
    .from("lead_verifications")
    .select("id, email_verified, created_at")
    .eq("id", v)
    .maybeSingle();
  // Valid for 7 days after verification, then back through the funnel.
  if (!verif?.email_verified || Date.now() - new Date(verif.created_at as string).getTime() > 7 * 86400e3) {
    redirect("/free-planner?src=try");
  }

  // The teaser: first case of the newest published set.
  const { data: set } = await svc
    .from("case_sets")
    .select("id, title, subject_id, subjects(title)")
    .eq("status", "ready")
    .eq("is_published", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let caseData: { title: string; scenario: string; subject: string; total: number } | null = null;
  let questions: { id: string; question: string; options: string[]; correct_index: number; explanation: string | null }[] = [];
  if (set) {
    const { data: cs } = await svc
      .from("case_studies")
      .select("id, title, scenario")
      .eq("set_id", set.id)
      .order("seq")
      .limit(1)
      .maybeSingle();
    if (cs) {
      const [{ data: qRows }, { count: total }] = await Promise.all([
        svc.from("case_questions").select("id, question, options, correct_index, explanation").eq("case_id", cs.id).order("seq"),
        svc.from("case_studies").select("id", { count: "exact", head: true }).eq("set_id", set.id),
      ]);
      questions = (qRows ?? []) as typeof questions;
      caseData = {
        title: "Sample Case Scenario",
        scenario: cs.scenario as string,
        subject: (set.subjects as { title?: string } | null)?.title ?? "CA",
        total: total ?? 1,
      };
    }
  }

  // Free sample PDFs the admin marked public.
  const { data: samples } = await svc
    .from("repository_items")
    .select("id, title, kind")
    .eq("public_sample", true)
    .eq("is_active", true)
    .limit(6);

  return (
    <main>
      <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 760 }}>
        <span className="badge">🧩 Free case-scenario test</span>
        <h1 style={{ marginTop: 10 }}>You&apos;re verified — here&apos;s your case</h1>

        {caseData && questions.length > 0 ? (
          <>
            <p className="meta" style={{ marginTop: 6 }}>
              A real {caseData.subject} case scenario from our bank of {caseData.total}+ cases. Read it, answer the questions, and see how you score.
            </p>
            <TryCasePlayer title={caseData.title} scenario={caseData.scenario} questions={questions} />
          </>
        ) : (
          <div className="card" style={{ marginTop: 14 }}>
            <p className="muted" style={{ margin: 0 }}>The case bank is being prepared — meanwhile, build your free study plan below. 👇</p>
          </div>
        )}

        {(samples ?? []).length > 0 && (
          <>
            <h2 className="admin-section-title" style={{ marginTop: 26 }}>📚 Free sample downloads</h2>
            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              {(samples ?? []).map((it) => (
                <a key={it.id} className="list-row" href={`/api/sample/${it.id}`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", color: "inherit" }}>
                  <span className="row-title">📄 {it.title}</span>
                  <span className="btn small secondary">Download →</span>
                </a>
              ))}
            </div>
          </>
        )}

        <div className="card" style={{ marginTop: 26, textAlign: "center" }}>
          <h3 style={{ marginTop: 0 }}>Want the full bank — every case, chapter tests &amp; a day-by-day plan?</h3>
          <p className="muted" style={{ fontSize: ".9rem" }}>All free with an account. From CA Parveen Sharma — 36 years of teaching experience.</p>
          <Link className="btn" href="/free-planner?src=trycase">📅 Create my free account →</Link>
        </div>
      </section>
    </main>
  );
}
