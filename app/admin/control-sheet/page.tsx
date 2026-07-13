import Link from "next/link";
import AdminHero from "../_components/AdminHero";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Control sheet — Admin" };

const has = (v: unknown) => !!(v && String(v).trim());
const isPart = (cfg: Record<string, unknown>) => /[A-Za-z]/.test(String(cfg.class_no ?? ""));

type Sec = { id: string; topic_id: string; type: string; is_published: boolean; config: Record<string, unknown> | null };

// A single readiness cell: a count + a status colour (green ok / amber partial / red missing).
function Cell({ label, value, status, hint }: { label: string; value: string; status: "ok" | "warn" | "bad" | "none"; hint?: string }) {
  const color = status === "ok" ? "#16a34a" : status === "warn" ? "#b45309" : status === "bad" ? "#b91c1c" : "var(--muted)";
  const bg = status === "ok" ? "rgba(34,197,94,.10)" : status === "warn" ? "rgba(234,179,8,.12)" : status === "bad" ? "rgba(239,68,68,.10)" : "var(--bg-soft)";
  const icon = status === "ok" ? "✓" : status === "warn" ? "△" : status === "bad" ? "✕" : "·";
  return (
    <div style={{ background: bg, borderRadius: 10, padding: "8px 10px" }}>
      <div style={{ fontSize: ".72rem", color: "var(--muted)" }}>{label}</div>
      <div style={{ fontWeight: 700, color, fontSize: ".95rem" }}>{icon} {value}</div>
      {hint && <div style={{ fontSize: ".68rem", color: "var(--muted)", marginTop: 1 }}>{hint}</div>}
    </div>
  );
}

export default async function ControlSheetPage() {
  const svc = createServiceClient();
  const [{ data: subjects }, { data: topics }] = await Promise.all([
    svc.from("subjects").select("id, title, order_index, miq_rev1, miq_rev2").order("order_index").order("title"),
    svc
      .from("topics")
      .select("id, title, subject_id, order_index, is_combined, weightage_marks, important_qs_rev1, important_qs_rev2, book_pdf_url, icai_material_url, revision_notes_hand_url, revision_notes_typed_url, revision_paper_url, amendments_pdf_url")
      .order("order_index")
      .order("title"),
  ]);
  const topicIds = (topics ?? []).map((t) => t.id);

  const [{ data: secRows }, { data: repoRows }, { data: amendRows }] = await Promise.all([
    topicIds.length ? svc.from("sections").select("id, topic_id, type, is_published, config").in("topic_id", topicIds) : { data: [] as Sec[] },
    topicIds.length ? svc.from("repository_items").select("topic_id, kind, file_url, is_active").in("topic_id", topicIds) : { data: [] as { topic_id: string; kind: string; file_url: string | null; is_active: boolean }[] },
    topicIds.length ? svc.from("amendments").select("topic_id, is_published, notes_hand_url").in("topic_id", topicIds) : { data: [] as { topic_id: string; is_published: boolean; notes_hand_url: string | null }[] },
  ]);

  // Subject-level materials (RTP / MTP / past papers / ICAI), attempt-tagged.
  const subjectIds = (subjects ?? []).map((s) => s.id);
  const { data: subjMatRows } = subjectIds.length
    ? await svc.from("repository_items").select("subject_id, kind, title, valid_from_attempt, valid_to_attempt").in("subject_id", subjectIds).is("topic_id", null).eq("is_active", true).in("kind", ["mtp", "rtp", "past_papers", "icai"])
    : { data: [] as { subject_id: string; kind: string; title: string; valid_from_attempt: string | null; valid_to_attempt: string | null }[] };
  const subjMatBy = new Map<string, { kind: string; title: string; valid_from_attempt: string | null; valid_to_attempt: string | null }[]>();
  for (const m of subjMatRows ?? []) {
    const arr = subjMatBy.get(m.subject_id) ?? [];
    arr.push(m); subjMatBy.set(m.subject_id, arr);
  }

  const secByTopic = new Map<string, Sec[]>();
  for (const s of (secRows ?? []) as Sec[]) (secByTopic.get(s.topic_id) ?? secByTopic.set(s.topic_id, []).get(s.topic_id)!).push(s);

  // Question counts per test section.
  const testIds = ((secRows ?? []) as Sec[]).filter((s) => s.type === "mcq_test" || s.type === "subjective_test").map((s) => s.id);
  const [{ data: mcqQ }, { data: subjQ }] = await Promise.all([
    testIds.length ? svc.from("mcq_questions").select("section_id").in("section_id", testIds) : { data: [] as { section_id: string }[] },
    testIds.length ? svc.from("subjective_questions").select("section_id").in("section_id", testIds) : { data: [] as { section_id: string }[] },
  ]);
  const mcqCount = new Map<string, number>();
  for (const r of mcqQ ?? []) mcqCount.set(r.section_id, (mcqCount.get(r.section_id) ?? 0) + 1);
  const subjCount = new Map<string, number>();
  for (const r of subjQ ?? []) subjCount.set(r.section_id, (subjCount.get(r.section_id) ?? 0) + 1);

  const repoByTopic = new Map<string, Map<string, number>>();
  for (const r of repoRows ?? []) {
    if (!r.is_active || !has(r.file_url)) continue;
    const m = repoByTopic.get(r.topic_id) ?? repoByTopic.set(r.topic_id, new Map()).get(r.topic_id)!;
    m.set(r.kind, (m.get(r.kind) ?? 0) + 1);
  }
  const amendByTopic = new Map<string, { total: number; hand: number }>();
  for (const a of amendRows ?? []) {
    const m = amendByTopic.get(a.topic_id) ?? { total: 0, hand: 0 };
    m.total += 1;
    if (has(a.notes_hand_url)) m.hand += 1;
    amendByTopic.set(a.topic_id, m);
  }

  const topicsBySubject = new Map<string, typeof topics>();
  for (const t of topics ?? []) (topicsBySubject.get(t.subject_id) ?? topicsBySubject.set(t.subject_id, [] as never).get(t.subject_id)!).push(t);

  function rowFor(t: (NonNullable<typeof topics>)[number]) {
    const secs = secByTopic.get(t.id) ?? [];
    const classSecs = secs.filter((s) => s.type === "full_class_video");
    const classes = classSecs.filter((s) => !isPart((s.config ?? {}) as Record<string, unknown>)).length;
    const hand = classSecs.filter((s) => has((s.config as Record<string, unknown> | null)?.notes_hand_url)).length;
    const typed = classSecs.filter((s) => has((s.config as Record<string, unknown> | null)?.notes_typed_url)).length;
    const transcripts = classSecs.filter((s) => has((s.config as Record<string, unknown> | null)?.transcript)).length;

    const mcqSecs = secs.filter((s) => s.type === "mcq_test");
    const mcqReady = mcqSecs.filter((s) => (mcqCount.get(s.id) ?? 0) > 0).length;

    const descSecs = secs.filter((s) => s.type === "subjective_test");
    const cfgOf = (s: Sec) => (s.config ?? {}) as Record<string, unknown>;
    const descQuestions = descSecs.filter((s) => has(cfgOf(s).paper_question_pdf)).length; // question paper uploaded
    const descPaperReady = descSecs.filter((s) => has(cfgOf(s).paper_solution_pdf)).length;  // solution uploaded (for auto-grading)
    const descTyped = descSecs.filter((s) => (subjCount.get(s.id) ?? 0) > 0).length;
    // "Uploaded" = has a question paper OR typed questions. Solution is only needed for AI auto-grading.
    const descReady = descSecs.filter((s) => has(cfgOf(s).paper_question_pdf) || (subjCount.get(s.id) ?? 0) > 0).length;

    const repo = repoByTopic.get(t.id) ?? new Map<string, number>();
    const amd = amendByTopic.get(t.id) ?? { total: 0, hand: 0 };

    const missing: string[] = [];
    if (!t.is_combined) {
      if (!classes) missing.push("classes");
      if (classes && hand < classes) missing.push("handwritten notes");
      if (classes && transcripts < classes) missing.push("transcripts (for AI)");
    }
    if (mcqSecs.length && mcqReady < mcqSecs.length) missing.push("MCQ questions");
    if (descSecs.length && descReady < descSecs.length) missing.push("descriptive question papers");
    if (descQuestions && descPaperReady < descQuestions) missing.push("descriptive solution PDFs (for auto-grading)");
    if (amd.total && amd.hand < amd.total) missing.push("amendment notes");

    return { t, classes, hand, typed, transcripts, mcqSecs: mcqSecs.length, mcqReady, descSecs: descSecs.length, descReady, descQuestions, descPaperReady, descTyped, repo, amd, missing };
  }

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 1100 }}>
      <AdminHero
        badge="🧭 Control sheet"
        title="Everything uploaded — and what's still missing"
        subtitle="Per subject and topic: classes, notes, transcripts, MCQ & descriptive tests (and whether they're ready), MTP/RTP/past papers, question bank, and amendments. Red = missing, so you can fix it fast."
        back={{ href: "/admin", label: "Admin" }}
      />

      {(subjects ?? []).map((subj) => {
        const list = topicsBySubject.get(subj.id) ?? [];
        if (!list.length) return null;
        const rows = list.map(rowFor);
        const subTotals = {
          classes: rows.reduce((a, r) => a + r.classes, 0),
          topicsMissing: rows.filter((r) => r.missing.length).length,
        };
        return (
          <div key={subj.id} style={{ marginTop: 28 }}>
            <h2 style={{ fontSize: "1.25rem", marginBottom: 4 }}>{subj.title}</h2>
            <p className="muted" style={{ fontSize: ".85rem", marginTop: 0, marginBottom: 8 }}>
              {list.length} topics · 🎓 {subTotals.classes} classes ·{" "}
              {subTotals.topicsMissing === 0 ? <span style={{ color: "#16a34a", fontWeight: 700 }}>✓ all topics complete</span> : <span style={{ color: "#b91c1c", fontWeight: 700 }}>⚠️ {subTotals.topicsMissing} topic(s) need attention</span>}
            </p>
            {(() => {
              const mats = subjMatBy.get(subj.id) ?? [];
              const line = (kind: string, label: string, range?: boolean) => {
                const items = mats.filter((m) => m.kind === kind);
                if (!items.length) return <span style={{ color: "#b91c1c" }}>{label}: — </span>;
                const attempts = items.map((m) => (range ? (m.valid_to_attempt || m.valid_from_attempt) : m.valid_from_attempt) || "?").join(", ");
                return <span style={{ color: "#16a34a" }}>{label}: {items.length} ({kind === "icai" ? "AI only" : attempts}) </span>;
              };
              return (
                <div style={{ fontSize: ".82rem", marginBottom: 12, display: "flex", gap: 14, flexWrap: "wrap", fontWeight: 600 }}>
                  {line("rtp", "📄 RTP")}
                  {line("mtp", "📄 MTP")}
                  {line("past_papers", "🗂️ Past papers", true)}
                  {line("icai", "🏛️ ICAI")}
                  <span style={{ color: (subj.miq_rev1 && subj.miq_rev2) ? "#16a34a" : "#b91c1c" }}>📌 Imp. Qs: {subj.miq_rev1 ? "R1✓" : "R1—"} {subj.miq_rev2 ? "R2✓" : "R2—"}</span>
                </div>
              );
            })()}

            <div style={{ display: "grid", gap: 12 }}>
              {rows.map((r) => (
                <div key={r.t.id} className="card" style={{ borderColor: r.missing.length ? "#fca5a5" : "var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
                    <Link href={`/admin/topics/${r.t.id}`} style={{ color: "var(--accent)", fontWeight: 700, fontSize: "1.02rem" }}>
                      {r.t.is_combined ? "🧩 " : ""}{r.t.title}
                    </Link>
                    {r.missing.length === 0 ? (
                      <span style={{ color: "#16a34a", fontWeight: 700, fontSize: ".85rem" }}>✓ complete</span>
                    ) : (
                      <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {r.missing.map((m) => (
                          <span key={m} style={{ fontSize: ".72rem", background: "#fee2e2", color: "#b91c1c", padding: "2px 8px", borderRadius: 999 }}>⚠️ {m}</span>
                        ))}
                      </span>
                    )}
                  </div>

                  <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", marginTop: 12 }}>
                    <Cell label="🎓 Classes" value={String(r.classes)} status={r.classes ? "ok" : (r.t.is_combined ? "none" : "bad")} />
                    <Cell label="✍️ Handwritten notes" value={`${r.hand}/${r.classes || 0}`} status={!r.classes ? "none" : r.hand >= r.classes ? "ok" : r.hand ? "warn" : "bad"} />
                    <Cell label="🎙️ Transcripts (AI)" value={`${r.transcripts}/${r.classes || 0}`} status={!r.classes ? "none" : r.transcripts >= r.classes ? "ok" : r.transcripts ? "warn" : "bad"} />
                    <Cell label="🧠 MCQ tests" value={r.mcqSecs ? `${r.mcqReady}/${r.mcqSecs} ready` : "0"} status={!r.mcqSecs ? "none" : r.mcqReady >= r.mcqSecs ? "ok" : r.mcqReady ? "warn" : "bad"} hint={r.mcqSecs ? "ready = has questions" : undefined} />
                    <Cell label="📝 Descriptive tests" value={r.descSecs ? `${r.descReady}/${r.descSecs} uploaded` : "0"} status={!r.descSecs ? "none" : r.descReady >= r.descSecs ? "ok" : r.descReady ? "warn" : "bad"} hint={r.descSecs ? `${r.descQuestions} question papers · ${r.descPaperReady} solutions · ${r.descTyped} typed` : undefined} />
                    <Cell label="📚 Question bank" value={String(r.repo.get("question_bank") ?? 0)} status={(r.repo.get("question_bank") ?? 0) ? "ok" : "none"} />
                    <Cell label="📄 RTP (topic)" value={String(r.repo.get("rtp") ?? 0)} status={(r.repo.get("rtp") ?? 0) ? "ok" : "none"} />
                    <Cell label="📄 MTP (topic)" value={String(r.repo.get("mtp") ?? 0)} status={(r.repo.get("mtp") ?? 0) ? "ok" : "none"} />
                    <Cell label="🗂️ Past papers (topic)" value={String(r.repo.get("past_papers") ?? 0)} status={(r.repo.get("past_papers") ?? 0) ? "ok" : "none"} />
                    <Cell label="📌 Amendments" value={r.amd.total ? `${r.amd.total}` : "0"} status={r.amd.total ? "ok" : "none"} hint={r.amd.total ? `${r.amd.hand} with handwritten notes` : undefined} />
                    <Cell label="🏛️ ICAI material" value={(r.repo.get("icai") ?? 0) || has(r.t.icai_material_url) ? "✓" : "—"} status={(r.repo.get("icai") ?? 0) || has(r.t.icai_material_url) ? "ok" : "none"} />
                    <Cell label="📕 Book" value={has(r.t.book_pdf_url) ? "✓" : "—"} status={has(r.t.book_pdf_url) ? "ok" : "none"} />
                    <Cell label="🔁 Revision notes" value={has(r.t.revision_notes_hand_url) || has(r.t.revision_notes_typed_url) ? "✓" : "—"} status={has(r.t.revision_notes_hand_url) || has(r.t.revision_notes_typed_url) ? "ok" : "none"} hint={has(r.t.revision_notes_hand_url) ? "handwritten ✓" : undefined} />
                    <Cell label="🎯 Weightage" value={r.t.weightage_marks ? `${r.t.weightage_marks}` : "—"} status={r.t.weightage_marks ? "ok" : "none"} />
                    <Cell label="📌 Revision Qs (1st/2nd)" value={`${has(r.t.important_qs_rev1) ? "✓" : "—"}/${has(r.t.important_qs_rev2) ? "✓" : "—"}`} status={has(r.t.important_qs_rev1) && has(r.t.important_qs_rev2) ? "ok" : has(r.t.important_qs_rev1) || has(r.t.important_qs_rev2) ? "warn" : "none"} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
