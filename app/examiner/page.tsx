import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { claimCopy } from "./actions";
import SubmitButton from "@/app/components/SubmitButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Examiner desk — CA Parveen Sharma" };

// The examiner desk: every submitted descriptive copy, filterable by subject /
// test / topic. Claim a copy to check it; a copy being checked by another
// examiner is highlighted and cannot be claimed twice.
export default async function ExaminerDesk(props: { searchParams: Promise<{ subject?: string; section?: string; status?: string; done?: string }> }) {
  const searchParams = await props.searchParams;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/examiner");
  const { data: me } = await supabase.from("profiles").select("role, full_name").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin" && me?.role !== "faculty") redirect("/dashboard");

  const svc = createServiceClient();
  const { data: rows } = await svc
    .from("descriptive_attempts")
    .select("id, student_id, section_id, status, review_status, examiner_name, examiner_id, submitted_at, awarded_marks, total_marks, examiner_checked_at")
    .in("status", ["submitted", "graded"])
    .order("submitted_at", { ascending: false })
    .limit(400);

  const sectionIds = [...new Set((rows ?? []).map((r) => r.section_id as string))];
  const studentIds = [...new Set((rows ?? []).map((r) => r.student_id as string))];
  const [{ data: sections }, { data: students }] = await Promise.all([
    sectionIds.length ? svc.from("sections").select("id, title, topic_id").in("id", sectionIds) : Promise.resolve({ data: [] as never[] }),
    studentIds.length ? svc.from("profiles").select("id, full_name, email").in("id", studentIds) : Promise.resolve({ data: [] as never[] }),
  ]);
  const topicIds = [...new Set((sections ?? []).map((s) => s.topic_id as string))];
  const { data: topics } = topicIds.length
    ? await svc.from("topics").select("id, title, subject_id, subjects(id, title)").in("id", topicIds)
    : { data: [] as never[] };

  const secById = new Map((sections ?? []).map((s) => [s.id as string, s]));
  const topById = new Map((topics ?? []).map((t) => [t.id as string, t]));
  const stuById = new Map((students ?? []).map((s) => [s.id as string, s]));

  type Item = {
    id: string; student: string; test: string; topic: string; subject: string; subjectId: string; sectionId: string;
    submittedAt: string | null; ai: number | null; total: number | null;
    review: string; examiner: string | null; mine: boolean; checkedAt: string | null; aiPending: boolean;
  };
  const items: Item[] = (rows ?? []).map((r) => {
    const sec = secById.get(r.section_id as string);
    const top = sec ? topById.get(sec.topic_id as string) : undefined;
    const subj = (top as { subjects?: { id?: string; title?: string } } | undefined)?.subjects;
    return {
      id: r.id as string,
      student: (stuById.get(r.student_id as string)?.full_name as string) || (stuById.get(r.student_id as string)?.email as string) || "Student",
      test: (sec?.title as string) ?? "Descriptive test",
      topic: (top as { title?: string } | undefined)?.title ?? "—",
      subject: subj?.title ?? "—",
      subjectId: subj?.id ?? "",
      sectionId: r.section_id as string,
      submittedAt: (r.submitted_at as string) ?? null,
      ai: r.awarded_marks as number | null,
      total: r.total_marks as number | null,
      review: (r.review_status as string) ?? "checked",
      examiner: (r.examiner_name as string) ?? null,
      mine: r.examiner_id === user.id,
      checkedAt: (r.examiner_checked_at as string) ?? null,
      aiPending: r.status === "submitted",
    };
  });

  // Filters (subject / test); status tab defaults to "to check".
  const fSubject = searchParams.subject ?? "";
  const fSection = searchParams.section ?? "";
  const fStatus = searchParams.status ?? "open";
  let list = items;
  if (fSubject) list = list.filter((i) => i.subjectId === fSubject);
  if (fSection) list = list.filter((i) => i.sectionId === fSection);
  if (fStatus === "open") list = list.filter((i) => i.review !== "checked");
  else if (fStatus === "checked") list = list.filter((i) => i.review === "checked");

  const subjects = [...new Map(items.map((i) => [i.subjectId, i.subject])).entries()].filter(([id]) => id);
  const tests = [...new Map(items.filter((i) => !fSubject || i.subjectId === fSubject).map((i) => [i.sectionId, i.test])).entries()];
  const openCount = items.filter((i) => i.review !== "checked").length;

  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams({ subject: fSubject, section: fSection, status: fStatus, ...over });
    [...p.entries()].forEach(([k, v]) => { if (!v) p.delete(k); });
    return `/examiner?${p.toString()}`;
  };

  return (
    <main>
      <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 980 }}>
        <span className="badge">🧑‍🏫 Examiner desk</span>
        <h1 style={{ margin: "12px 0 4px" }}>Descriptive copies</h1>
        <p className="muted">
          AI checks every copy first; you verify and release it. The student sees marks and the checked copy only
          after you submit. <strong>{openCount}</strong> cop{openCount === 1 ? "y" : "ies"} waiting.
        </p>
        {searchParams.done && <div className="notice ok" style={{ marginTop: 10 }}>✅ Copy released to the student.</div>}

        {/* Filters */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "16px 0" }}>
          {[["open", "🔴 To check"], ["checked", "✅ Checked"], ["all", "All"]].map(([k, label]) => (
            <Link key={k} className={`btn small ${fStatus === k ? "" : "secondary"}`} href={qs({ status: k })}>{label}</Link>
          ))}
          <span style={{ width: 12 }} />
          <Link className={`btn small ${!fSubject ? "" : "secondary"}`} href={qs({ subject: "", section: "" })}>All subjects</Link>
          {subjects.map(([id, title]) => (
            <Link key={id} className={`btn small ${fSubject === id ? "" : "secondary"}`} href={qs({ subject: id, section: "" })}>{title}</Link>
          ))}
        </div>
        {tests.length > 1 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <Link className={`btn small ${!fSection ? "" : "secondary"}`} href={qs({ section: "" })}>All tests</Link>
            {tests.map(([id, title]) => (
              <Link key={id} className={`btn small ${fSection === id ? "" : "secondary"}`} href={qs({ section: id })}>{title}</Link>
            ))}
          </div>
        )}

        <div style={{ display: "grid", gap: 8 }}>
          {list.length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>🎉 Nothing here — all caught up.</p></div>}
          {list.map((i) => (
            <div key={i.id} className="list-row" style={{
              flexWrap: "wrap",
              border: i.review === "checking" ? "2px solid #f59e0b" : undefined,
              background: i.review === "checking" ? "rgba(245,158,11,.06)" : undefined,
            }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <span className="row-title">🧑‍🎓 {i.student}</span>
                <p className="row-sub">
                  📄 {i.test} · 📚 {i.subject} · 📖 {i.topic}
                  {i.submittedAt ? ` · submitted ${new Date(i.submittedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : ""}
                  {i.aiPending ? " · ⏳ AI check pending" : i.ai != null ? ` · 🤖 AI: ${i.ai}${i.total ? `/${i.total}` : ""}` : ""}
                </p>
              </div>
              <div className="row-actions" style={{ alignItems: "center" }}>
                {i.review === "pending" && (
                  <form action={claimCopy} style={{ display: "inline" }}>
                    <input type="hidden" name="id" value={i.id} />
                    <SubmitButton className="btn small">🖊️ Check this copy</SubmitButton>
                  </form>
                )}
                {i.review === "checking" && (i.mine ? (
                  <Link className="btn small" href={`/examiner/${i.id}`}>▶ Continue checking</Link>
                ) : (
                  <span style={{ color: "#b45309", fontWeight: 700, fontSize: ".85rem" }}>🔍 Being checked by {i.examiner ?? "another examiner"}</span>
                ))}
                {i.review === "checked" && (
                  <span style={{ color: "#16a34a", fontWeight: 700, fontSize: ".85rem" }}>
                    ✅ Checked by {i.examiner ?? "examiner"}{i.checkedAt ? ` · ${new Date(i.checkedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}
                  </span>
                )}
                {i.review === "checked" && <Link className="btn small secondary" href={`/examiner/${i.id}`}>View</Link>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
