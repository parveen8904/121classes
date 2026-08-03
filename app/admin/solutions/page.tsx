import SubmitButton from "@/app/components/SubmitButton";
import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../_components/AdminHero";
import SelectAllKeys from "./SelectAllKeys";
import PdfUpload from "../_components/PdfUpload";
import { draftMissingKeys, auditOfficialSolutions, saveSolutionPdf, deleteSolution, deleteSelectedSolutions, requeueSelectedSolutions, approveSolution, unapproveSolution, saveSolution, saveSolutionVideo, retrySolution, generateExplanations } from "./actions";

// Answer keys for the uploaded papers, and the button that makes them real.
// Nothing here is used by the portal or the evaluator until it is approved.

export const dynamic = "force-dynamic";
// "Draft the waiting ones now" runs several full-paper AI calls in one press.
export const maxDuration = 300;

type Row = {
  id: string;
  repo_item_id: string | null;
  section_id: string | null;
  solution_md: string | null;
  status: string;
  error: string | null;
  parts: number;
  edited: boolean;
  video_url: string | null;
  generated_at: string | null;
  repository_items: { title: string; kind: string; subjects: { title: string } | null } | null;
  sections: {
    title: string;
    question_pdf: string | null;
    solution_pdf: string | null;
    topics: { subjects: { title: string } | null } | null;
  } | null;
};

const LABEL: Record<string, string> = {
  queued: "⏳ Waiting to be drafted",
  drafting: "✍️ Being drafted now",
  drafted: "📝 Drafted — needs your approval",
  approved: "✅ Approved",
  failed: "⚠️ Draft failed",
};

export default async function AdminSolutionsPage(props: {
  searchParams: Promise<{ queued?: string; open?: string; mcq?: string; cases?: string; drafted?: string; draftfailed?: string; stillqueued?: string; removed?: string; keptapproved?: string; requeued?: string; mcqleft?: string; casesleft?: string; keypdf?: string;
  checked?: string; typeset?: string; replaced?: string; auditfailed?: string; auditleft?: string }>;
}) {
  const searchParams = await props.searchParams;
  const svc = createServiceClient();

  const { data } = await svc
    .from("item_solutions")
    .select(
      "id, repo_item_id, section_id, solution_md, status, error, parts, edited, video_url, generated_at, " +
        "repository_items(title, kind, subjects(title)), " +
        "sections(title, question_pdf:config->>paper_question_pdf, " +
        "solution_pdf:config->>paper_solution_pdf, topics(subjects(title)))",
    )
    .order("status")
    .limit(500);
  const rows = (data ?? []) as unknown as Row[];

  // How many descriptive tests still have no key of any kind.
  const { count: testsWithoutKey } = await svc
    .from("sections")
    .select("id", { count: "exact", head: true })
    .eq("is_published", true)
    .not("m_paper_question_pdf", "is", null)
    .is("m_paper_solution_pdf", null);

  // How many answer explanations are still missing (the "why", not the answer).
  // Counted as two head-only counts rather than by pulling every question id
  // and every stored key into memory — this page is opened often, and that
  // read was two full table scans each time.
  const [{ count: mcqTotal }, { count: mcqHave }] = await Promise.all([
    svc.from("mcq_questions").select("id", { count: "exact", head: true }),
    svc.from("site_settings").select("key", { count: "exact", head: true }).like("key", "mcqx:%"),
  ]);
  const mcqMissing = Math.max(0, (mcqTotal ?? 0) - (mcqHave ?? 0));
  const { count: caseMissing } = await svc
    .from("case_questions")
    .select("id", { count: "exact", head: true })
    .is("explanation", null);

  const byStatus = (s: string) => rows.filter((r) => r.status === s);
  const drafted = byStatus("drafted");
  const approved = byStatus("approved");
  const waiting = [...byStatus("queued"), ...byStatus("drafting")];
  const failed = byStatus("failed");

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="🗝️ Answer keys"
        title="Solutions for uploaded papers"
        subtitle="The descriptive tests students sit inside a topic, drafted from their own question paper. A key does nothing until you approve it: approved keys are what students see after they submit, and what the AI marks their answer books against."
        back={{ href: "/admin", label: "Admin" }}
      />

      {searchParams.checked && (
        <div className="notice ok">
          🔍 Checked {searchParams.checked} uploaded solution(s): {searchParams.typeset} properly typeset,{" "}
          <strong>{searchParams.replaced} were scanned student copies</strong> and have been replaced with a typeset
          key.
          {Number(searchParams.auditfailed) > 0 && ` ${searchParams.auditfailed} could not be settled.`}
          {Number(searchParams.auditleft) > 0
            ? ` ${searchParams.auditleft} still to check — press again.`
            : " Nothing left to check."}
        </div>
      )}

      {searchParams.keypdf && (
        <div className="notice ok">
          {searchParams.keypdf === "1"
            ? "📕 Your answer key PDF is attached — this paper will be marked against it."
            : "The answer key PDF was removed; this paper falls back to the approved draft."}
        </div>
      )}

      {searchParams.removed && (
        <div className="notice ok">
          {searchParams.removed === "0"
            ? "Nothing was ticked, so nothing was deleted."
            : `🗑️ ${searchParams.removed} deleted.` +
              (Number(searchParams.keptapproved) > 0
                ? ` ${searchParams.keptapproved} approved key(s) were KEPT — an approved key can only be removed one at a time, on its own row.`
                : "")}
        </div>
      )}

      {searchParams.requeued && (
        <div className="notice ok">
          {searchParams.requeued === "0"
            ? "Nothing was ticked."
            : `🔄 ${searchParams.requeued} put back in the queue — press “Draft the waiting ones now” to redraft them.`}
        </div>
      )}

      {searchParams.drafted && (
        <div className="notice ok">
          {Number(searchParams.queued) > 0 && `Found ${searchParams.queued} test(s) with no key. `}
          ✍️ {searchParams.drafted} drafted and ready for you to read.
          {Number(searchParams.draftfailed) > 0 && ` ${searchParams.draftfailed} could not be drafted — the reason is on each.`}
          {Number(searchParams.stillqueued) > 0
            ? ` ${searchParams.stillqueued} still to go — press the button again to carry on, or leave it and tonight's run finishes them.`
            : " Nothing left to draft."}
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "center" }}>
          <div><strong style={{ fontSize: "1.5rem" }}>{approved.length}</strong><div className="muted">approved</div></div>
          <div><strong style={{ fontSize: "1.5rem" }}>{drafted.length}</strong><div className="muted">awaiting your approval</div></div>
          <div><strong style={{ fontSize: "1.5rem" }}>{waiting.length}</strong><div className="muted">in the drafting queue</div></div>
          {failed.length > 0 && <div><strong style={{ fontSize: "1.5rem" }}>{failed.length}</strong><div className="muted">failed</div></div>}
          <div style={{ marginLeft: "auto" }}>
            <form action={draftMissingKeys} style={{ display: "inline-block", marginRight: 8 }}>
              <SubmitButton className="btn" savedLabel="Drafting…">✍️ Draft the missing answer keys</SubmitButton>
            </form>
            <form action={auditOfficialSolutions} style={{ display: "inline-block" }}>
              <SubmitButton className="btn small secondary" savedLabel="Checking…">
                🔍 Check the uploaded solutions
              </SubmitButton>
            </form>
          </div>
        </div>
        <p className="muted" style={{ fontSize: ".85rem", marginTop: 10, marginBottom: 0 }}>
          These are the <strong>descriptive tests</strong> students sit inside a topic — {testsWithoutKey ?? 0} of
          them have no answer key, so their question paper is read directly and the suggested answers written from
          it. Repository MTP / RTP papers are deliberately not drafted here. A draft marks nobody&apos;s paper until
          you approve it.
        </p>
      </div>

      {/* MCQ + case-study explanations — the answers exist, the "why" is what
          was never generated for some of them. */}
      <div className="card" style={{ marginBottom: 20 }}>
        <h2 className="admin-section-title">❓ Answer explanations</h2>
        {searchParams.mcq && (
          <div className="notice ok">
            Wrote {searchParams.mcq} MCQ and {searchParams.cases ?? 0} case-study explanations.{" "}
            {Number(searchParams.mcqleft) + Number(searchParams.casesleft) > 0
              ? `${searchParams.mcqleft} MCQ and ${searchParams.casesleft} case questions still to go — press again to finish them.`
              : "Nothing left — every question now has its reason."}
          </div>
        )}
        <p className="muted" style={{ fontSize: ".85rem", marginTop: 0 }}>
          Every question already has its correct answer. These are the one-line reasons shown in a student&apos;s report —{" "}
          <strong>{mcqMissing}</strong> chapter MCQs and <strong>{caseMissing ?? 0}</strong> case-study questions still have
          none.
        </p>
        {(mcqMissing > 0 || (caseMissing ?? 0) > 0) && (
          <form action={generateExplanations}>
            <SubmitButton className="btn small" savedLabel="Writing…">✍️ Generate the missing explanations</SubmitButton>
            <span className="muted" style={{ fontSize: ".8rem", marginLeft: 8 }}>
              Six batches at a time, so one press clears most of the backlog. The nightly worker mops up anything left.
            </span>
          </form>
        )}
      </div>

      {drafted.length === 0 && approved.length === 0 && waiting.length === 0 && (
        <div className="card">
          <p className="muted">
            No keys yet. Press the button above and the AI will draft an answer key for each descriptive test that has no
            solution file.
          </p>
        </div>
      )}

      {/* Multi-select. Each row's tick box attaches to this form by id, so no
          form ends up nested inside another. */}
      {rows.length > 0 && (
        <form
          id="keyspick"
          action={deleteSelectedSolutions}
          className="card"
          style={{ marginBottom: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}
        >
          <SelectAllKeys formId="keyspick" name="ids" />
          <span className="muted" style={{ fontSize: ".85rem" }}>then:</span>
          <SubmitButton className="btn small secondary" savedLabel="Deleting…">🗑️ Delete the ticked ones</SubmitButton>
          <button type="submit" className="btn small secondary" formAction={requeueSelectedSolutions}>
            🔄 Draft the ticked ones again
          </button>
        </form>
      )}

      {[...drafted, ...failed, ...waiting, ...approved].map((r) => {
        // A key belongs either to a repository paper or to a descriptive test.
        const item = r.repository_items
          ? {
              title: r.repository_items.title,
              kind: r.repository_items.kind,
              subject: r.repository_items.subjects?.title ?? "—",
            }
          : r.sections
            ? {
                title: r.sections.title,
                kind: "descriptive test",
                subject: r.sections.topics?.subjects?.title ?? "—",
              }
            : null;
        const open = searchParams.open === r.id;
        // Served through our own proxy, which mints a short-lived signed URL —
        // the paper itself stays private.
        const paperRef = r.sections?.question_pdf ?? null;
        const paperHref = paperRef ? `/api/file?u=${encodeURIComponent(paperRef)}` : null;
        return (
          <div className="card" key={r.id} style={{ marginBottom: 14, borderColor: r.status === "approved" ? "#16a34a" : undefined }}>
            <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
              <input type="checkbox" form="keyspick" name="ids" value={r.id} aria-label={`Select ${item?.title ?? "paper"}`} />
              <strong>{item?.title ?? "Paper"}</strong>
              <span className="badge">{item?.subject ?? "—"}</span>
              <span className="badge">{item?.kind ?? ""}</span>
              <span className="muted" style={{ marginLeft: "auto" }}>{LABEL[r.status] ?? r.status}{r.edited ? " · edited by you" : ""}</span>
            </div>

            {r.error && <p className="muted" style={{ color: "#b91c1c", fontSize: ".85rem" }}>{r.error}</p>}

            {r.solution_md && (
              <details open={open} style={{ marginTop: 10 }}>
                <summary className="btn as-btn small">
                  {r.status === "approved" ? "View the approved key" : "Read the draft before approving"}
                </summary>
                <form action={saveSolution} style={{ marginTop: 10 }}>
                  <input type="hidden" name="id" value={r.id} />
                  {/* The question paper sits BESIDE the answer. Reading a key
                      without the questions in front of you is guesswork, and
                      opening two files by hand to do it is worse. */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: paperHref ? "1fr 1fr" : "1fr",
                      gap: 10,
                      alignItems: "stretch",
                    }}
                    className="key-split"
                  >
                    {paperHref && (
                      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                          <strong style={{ fontSize: ".8rem" }}>📄 Question paper</strong>
                          <a className="btn small secondary" href={paperHref} target="_blank" rel="noopener noreferrer">
                            Open in a new tab
                          </a>
                          <a className="btn small secondary" href={`${paperHref}&dl=1`} download>
                            ⬇️ Download
                          </a>
                        </div>
                        <iframe
                          src={paperHref}
                          title={`Question paper — ${item?.title ?? ""}`}
                          style={{ width: "100%", height: "72vh", border: "1px solid var(--border)", borderRadius: 8, background: "#fff" }}
                        />
                      </div>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                      <strong style={{ fontSize: ".8rem", marginBottom: 6 }}>✍️ Draft answer key — edit freely</strong>
                      <textarea
                        name="solution_md"
                        defaultValue={r.solution_md}
                        style={{
                          width: "100%",
                          height: paperHref ? "72vh" : "auto",
                          minHeight: 320,
                          fontFamily: "ui-monospace, monospace",
                          fontSize: ".8rem",
                        }}
                      />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                    <SubmitButton className="btn small secondary" savedLabel="Saved">💾 Save edits</SubmitButton>
                    <SubmitButton className="btn small" savedLabel="Approved ✓" name="approve" value="1">
                      💾✅ Save and approve
                    </SubmitButton>
                  </div>
                </form>
              </details>
            )}

            {r.section_id && (
              <form action={saveSolutionPdf} style={{ marginTop: 10 }}>
                <input type="hidden" name="section_id" value={r.section_id} />
                <PdfUpload
                  name="paper_solution_pdf"
                  defaultValue={r.sections?.solution_pdf ?? ""}
                  label="📕 Your own answer key (PDF) — optional"
                />
                <p className="muted" style={{ fontSize: ".8rem", margin: "4px 0 6px" }}>
                  Attach a PDF and the paper is marked against it instead of the draft above. Leave it empty to use
                  the draft you approve.
                </p>
                <SubmitButton className="btn small secondary" savedLabel="Saved">💾 Save this answer key</SubmitButton>
              </form>
            )}

            <form action={saveSolutionVideo} style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
              <input type="hidden" name="id" value={r.id} />
              <input
                name="video_url"
                defaultValue={r.video_url ?? ""}
                placeholder="🎥 Video solution link (YouTube / Bunny) — optional"
                style={{ flex: "1 1 320px", fontSize: ".85rem" }}
              />
              <SubmitButton className="btn small secondary" savedLabel="Saved">Save video link</SubmitButton>
            </form>

            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              {r.status === "drafted" && (
                <form action={approveSolution}>
                  <input type="hidden" name="id" value={r.id} />
                  <SubmitButton className="btn small" savedLabel="Approved ✓">✅ Approve as the final solution</SubmitButton>
                </form>
              )}
              {r.status === "approved" && (
                <form action={unapproveSolution}>
                  <input type="hidden" name="id" value={r.id} />
                  <SubmitButton className="btn small secondary" savedLabel="Withdrawn">↩︎ Withdraw approval</SubmitButton>
                </form>
              )}
              {r.status === "failed" && (
                <form action={retrySolution}>
                  <input type="hidden" name="id" value={r.id} />
                  <SubmitButton className="btn small secondary" savedLabel="Requeued">🔁 Try drafting again</SubmitButton>
                </form>
              )}
              {/* Delete sits last and apart — on an approved row it also takes
                  away what the evaluator marks that test against, so the label
                  says which one it is. */}
              <form action={deleteSolution} style={{ marginLeft: "auto" }}>
                <input type="hidden" name="id" value={r.id} />
                <SubmitButton className="btn small secondary" savedLabel="Deleted">
                  {r.status === "approved" ? "🗑️ Delete this approved key" : "🗑️ Delete this draft"}
                </SubmitButton>
              </form>
            </div>
          </div>
        );
      })}
    </section>
  );
}
