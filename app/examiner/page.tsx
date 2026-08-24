import { formatDate, formatDateTime } from "@/lib/dates";
import { checkedByLine } from "@/lib/examinerName";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { claimCopy, giveMoreTime, rebuildCopyForAttempt } from "./actions";
import SubmitButton from "@/app/components/SubmitButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Examiner desk" };

// The examiner desk: every submitted descriptive copy, filterable by subject /
// test / topic. Claim a copy to check it; a copy being checked by another
// examiner is highlighted and cannot be claimed twice.
export default async function ExaminerDesk(props: { searchParams: Promise<{ subject?: string; section?: string; status?: string; done?: string; err?: string }> }) {
  const searchParams = await props.searchParams;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/examiner");
  const { data: me } = await supabase.from("profiles").select("role, full_name").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin" && me?.role !== "faculty") redirect("/dashboard");

  const svc = createServiceClient();
  const { data: rows } = await svc
    .from("descriptive_attempts")
    .select("id, student_id, section_id, mock_paper_id, status, review_status, examiner_name, examiner_id, submitted_at, awarded_marks, total_marks, examiner_checked_at, grade_error, grade_tries")
    .in("status", ["submitted", "graded"])
    .order("submitted_at", { ascending: false })
    .limit(400);

  const sectionIds = [...new Set((rows ?? []).map((r) => r.section_id as string).filter(Boolean))];
  // A mock submission has no section — its title lives with the mock paper.
  const mockIds = [...new Set((rows ?? []).map((r) => r.mock_paper_id as string).filter(Boolean))];
  const { data: mockRows } = mockIds.length
    ? await svc.from("mock_papers").select("id, title, course, subject").in("id", mockIds)
    : { data: [] as never[] };
  const mockById = new Map((mockRows ?? []).map((m) => [m.id as string, m]));
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
    aiFailed: boolean; aiError: string | null;
  };
  const items: Item[] = (rows ?? []).map((r) => {
    const sec = secById.get(r.section_id as string);
    const top = sec ? topById.get(sec.topic_id as string) : undefined;
    const subj = (top as { subjects?: { id?: string; title?: string } } | undefined)?.subjects;
    return {
      id: r.id as string,
      student: (stuById.get(r.student_id as string)?.full_name as string) || (stuById.get(r.student_id as string)?.email as string) || "Student",
      test: (sec?.title as string)
        ?? (mockById.get(r.mock_paper_id as string)?.title as string)
        ?? "Descriptive test",
      topic: (top as { title?: string } | undefined)?.title
        ?? (r.mock_paper_id ? "Mock test paper" : "—"),
      subject: subj?.title ?? (mockById.get(r.mock_paper_id as string)?.subject as string) ?? "—",
      subjectId: subj?.id ?? "",
      sectionId: r.section_id as string,
      submittedAt: (r.submitted_at as string) ?? null,
      ai: r.awarded_marks as number | null,
      total: r.total_marks as number | null,
      // Missing means waiting, never "already done" — a copy with no review
      // status is one nobody has looked at yet.
      review: (r.review_status as string) ?? "pending",
      examiner: (r.examiner_name as string) ?? null,
      mine: r.examiner_id === user.id,
      checkedAt: (r.examiner_checked_at as string) ?? null,
      aiPending: r.status === "submitted",
      // Three failed attempts means it is not coming — say so, so the copy is
      // marked by hand rather than waited on for ever.
      aiFailed: r.status === "submitted" && (Number(r.grade_tries) || 0) >= 3,
      aiError: (r.grade_error as string) ?? null,
    };
  });

  // STUDENTS WHO NEVER GOT THEIR PAPER IN.
  //
  // This desk used to list only "submitted" and "graded", which meant a student
  // whose clock ran out was invisible here — the one person who most needed
  // somebody to notice. On 13 August that cost an evening: the founder could
  // see nothing, and reopening the test meant editing the database by hand.
  //
  // Anything still "started" past its deadline, or already "expired", and not
  // older than two days (after that it is a paper they chose not to sit, not
  // somebody stuck at a scanner).
  const { data: stuckRows } = await svc
    .from("descriptive_attempts")
    .select("id, student_id, section_id, status, started_at, deadline_at, extra_time_minutes, extra_time_by")
    .in("status", ["started", "expired"])
    .gte("started_at", new Date(Date.now() - 2 * 86400_000).toISOString())
    .order("deadline_at", { ascending: false });

  const stuck = ((stuckRows ?? []) as {
    id: string; student_id: string; section_id: string; status: string;
    started_at: string; deadline_at: string; extra_time_minutes: number | null; extra_time_by: string | null;
  }[]).filter((r) => new Date(r.deadline_at).getTime() < Date.now());

  const stuckNames = new Map<string, string>();
  const stuckTests = new Map<string, string>();
  if (stuck.length) {
    const [{ data: ps }, { data: secs }] = await Promise.all([
      svc.from("profiles").select("id, full_name").in("id", [...new Set(stuck.map((r) => r.student_id))]),
      svc.from("sections").select("id, title").in("id", [...new Set(stuck.map((r) => r.section_id))]),
    ]);
    for (const x of (ps ?? []) as { id: string; full_name: string | null }[]) stuckNames.set(x.id, x.full_name ?? "Student");
    for (const x of (secs ?? []) as { id: string; title: string | null }[]) stuckTests.set(x.id, x.title ?? "Test");
  }

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
        {searchParams.done === "copy" && (
          <div className="notice ok" style={{ marginTop: 10 }}>
            🖍️ The checked copy has been drawn again from the marks already on record — the paper was not re-marked,
            so nothing about the result has changed.
          </div>
        )}
        {searchParams.err && <div className="notice err" style={{ marginTop: 10 }}>{searchParams.err}</div>}
        {searchParams.done === "time" && (
          <div className="notice ok" style={{ marginTop: 10 }}>
            ⏱️ Extra time given, and the student has been emailed — the message tells them to reload the page,
            because the timer on their screen only changes when they do.
          </div>
        )}
        {searchParams.done && searchParams.done !== "time" && <div className="notice ok" style={{ marginTop: 10 }}>✅ Copy released to the student.</div>}

        {/* WHOEVER IS STUCK, WITH THE ONLY BUTTON THAT HELPS THEM. */}
        {fStatus === "stuck" && (
          <div className="card" style={{ marginTop: 14 }}>
            <strong>⏰ Started but never submitted</strong>
            <p className="muted" style={{ fontSize: ".85rem", lineHeight: 1.7, margin: "6px 0 12px" }}>
              These students opened a paper and the upload window closed before anything arrived — usually a scan
              that took longer than expected. Giving time reopens the upload; it does <strong>not</strong> reset the
              paper, so they cannot see the questions afresh. They are emailed, and told to reload.
            </p>
            {stuck.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>Nobody is stuck. Every paper begun in the last two days was handed in.</p>
            ) : stuck.map((r) => (
              <div key={r.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <strong>{stuckNames.get(r.student_id) ?? "Student"}</strong>
                  <div className="muted" style={{ fontSize: ".82rem" }}>
                    {stuckTests.get(r.section_id) ?? "Test"} · closed {formatDateTime(r.deadline_at)}
                    {r.extra_time_minutes ? ` · already given ${r.extra_time_minutes} min by ${r.extra_time_by ?? "someone"}` : ""}
                  </div>
                </div>
                <form action={giveMoreTime} style={{ margin: 0, display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="hidden" name="id" value={r.id} />
                  <select name="minutes" defaultValue="15" style={{ marginBottom: 0, width: 92 }}>
                    <option value="10">10 min</option>
                    <option value="15">15 min</option>
                    <option value="30">30 min</option>
                    <option value="60">60 min</option>
                  </select>
                  <button className="btn small" type="submit">⏱️ Give time</button>
                </form>
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "16px 0" }}>
          {[["open", "🔴 To check"], ["checked", "✅ Checked"], ["all", "All"],
            ["stuck", `⏰ Ran out of time${stuck.length ? ` (${stuck.length})` : ""}`]].map(([k, label]) => (
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
                  {i.submittedAt ? ` · submitted ${formatDateTime(i.submittedAt)}` : ""}
                  {i.aiFailed
                    ? ` · ⚠️ AI could not check this copy — please mark it yourself${i.aiError ? ` (${i.aiError})` : ""}`
                    : i.aiPending
                      ? " · ⏳ AI check pending"
                      : i.ai != null
                        ? ` · 🤖 AI: ${i.ai}${i.total ? `/${i.total}` : ""}`
                        : ""}
                </p>
              </div>
              <div className="row-actions" style={{ alignItems: "center" }}>
                {/* A copy the AI has not finished with has no marks and no
                    annotated copy to show — opening it looks broken. Offer it
                    only when there is something to check, unless the AI has
                    given up, in which case it must be marked by hand. */}
                {i.review === "pending" && i.aiPending && !i.aiFailed && (
                  <span style={{ color: "#b45309", fontWeight: 700, fontSize: ".85rem" }}>
                    ⏳ AI is checking this — ready in a minute
                  </span>
                )}
                {i.review === "pending" && (!i.aiPending || i.aiFailed) && (
                  <form action={claimCopy} style={{ display: "inline" }}>
                    <input type="hidden" name="id" value={i.id} />
                    <SubmitButton className="btn small">
                      {i.aiFailed ? "🖊️ Mark this copy myself" : "🖊️ Check this copy"}
                    </SubmitButton>
                  </form>
                )}
                {/* The marks and the copy are separate things: the marking is
                    an AI call, the copy is a PDF drawn from a report we already
                    hold. When the copy is missing, redrawing it must not mean
                    paying to mark the paper again — or risking different marks
                    on a paper already read. */}
                {!i.aiPending && (
                  <form action={rebuildCopyForAttempt} style={{ display: "inline" }}>
                    <input type="hidden" name="id" value={i.id} />
                    <SubmitButton className="btn small secondary" savedLabel="Redrawn">
                      🖍️ Rebuild checked copy
                    </SubmitButton>
                  </form>
                )}
                {i.review === "checking" && (i.mine ? (
                  <Link className="btn small" href={`/examiner/${i.id}`}>▶ Continue checking</Link>
                ) : (
                  <span style={{ color: "#b45309", fontWeight: 700, fontSize: ".85rem" }}>🔍 Being checked by {i.examiner ?? "another examiner"}</span>
                ))}
                {i.review === "checked" && (
                  <span style={{ color: "#16a34a", fontWeight: 700, fontSize: ".85rem" }}>
                    ✅ {checkedByLine(i.examiner)}{i.checkedAt ? ` · ${formatDate(i.checkedAt)}` : ""}
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
