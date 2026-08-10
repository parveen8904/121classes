import { createServiceClient } from "@/lib/supabase/service";
import { classifySolutionPdf, draftSolutionFromPdf } from "@/lib/ai";
import { resolveFileUrl } from "@/lib/storage";

// Official solutions must be TYPESET.
//
// Some of the uploaded "official solutions" turned out to be scans of student
// answer books — so a student who finished a test and opened the official
// answer was shown another student's handwriting. That is wrong twice over:
// it is not a model answer, and it puts one student's paper in front of
// another.
//
// This walks every descriptive test that has a solution PDF, decides whether
// that PDF is a real typeset document or a handwritten copy, and where it is a
// handwritten copy: writes a proper typeset key from the QUESTION paper,
// approves it, and detaches the scan. The founder asked for this to happen
// without waiting for his approval — the scan being visible is the greater
// harm.

export type AuditResult = {
  checked: number;
  typeset: string[];
  replaced: string[];
  failed: string[];
  remaining: number;
};

type Row = {
  id: string;
  title: string;
  question_pdf: string | null;
  solution_pdf: string | null;
  marks: string | null;
  audit: string | null;
  topics: { subjects: { title: string } | null } | null;
};

const SELECT =
  "id, title, question_pdf:config->>paper_question_pdf, solution_pdf:config->>paper_solution_pdf, " +
  "marks:config->>paper_total_marks, audit:config->>solution_audit, topics(subjects(title))";

/** One pass. Re-run until `remaining` is 0. */
export async function auditSolutionPdfs(limit = 6, budgetMs = 230_000): Promise<AuditResult> {
  const svc = createServiceClient();
  const started = Date.now();
  const out: AuditResult = { checked: 0, typeset: [], replaced: [], failed: [], remaining: 0 };

  // Only tests that HAVE a solution PDF and have not been judged yet.
  const { data } = await svc
    .from("sections")
    .select(SELECT)
    .not("m_paper_solution_pdf", "is", null)
    .limit(500);

  const all = ((data ?? []) as unknown as Row[]).filter((r) => String(r.solution_pdf ?? "").trim());
  const todo = all.filter((r) => !r.audit);
  out.remaining = todo.length;

  for (const row of todo.slice(0, limit)) {
    if (Date.now() - started > budgetMs) break;
    const subject = row.topics?.subjects?.title ?? "";
    try {
      const solUrl = await resolveFileUrl(row.solution_pdf as string, 900);
      const verdict = solUrl ? await classifySolutionPdf(solUrl) : "unreadable";
      out.checked++;

      if (verdict === "typeset") {
        await stamp(svc, row.id, "typeset");
        out.typeset.push(row.title);
        continue;
      }

      // A handwritten copy (or one nothing can be read from) must not stand as
      // the official answer. Write a typeset key from the question paper.
      const qUrl = row.question_pdf ? await resolveFileUrl(row.question_pdf, 900) : "";
      if (!qUrl) {
        await stamp(svc, row.id, `${verdict}-no-question-paper`);
        out.failed.push(`${row.title}: ${verdict}, and no question paper to write a key from`);
        continue;
      }

      const text = await draftSolutionFromPdf({
        paperTitle: row.title,
        subject,
        questionPdfUrl: qUrl,
        totalMarks: Number(row.marks) || null,
      });
      if (!text) {
        await stamp(svc, row.id, `${verdict}-draft-failed`);
        out.failed.push(`${row.title}: ${verdict}, but the typeset key could not be written`);
        continue;
      }

      // Approved immediately, on the founder's instruction — a scanned student
      // copy sitting there as the official answer is the worse outcome.
      const { data: existing } = await svc
        .from("item_solutions")
        .select("id")
        .eq("section_id", row.id)
        .maybeSingle();
      const payload = {
        section_id: row.id,
        solution_md: text,
        status: "approved",
        parts: 1,
        generated_at: new Date().toISOString(),
        approved_at: new Date().toISOString(),
        error: null,
      };
      if (existing?.id) await svc.from("item_solutions").update(payload).eq("id", existing.id);
      else await svc.from("item_solutions").insert(payload);

      // Detach the scan so nothing serves it, but KEEP the file — it is a
      // student's paper and deleting somebody's work is not ours to do.
      await stamp(svc, row.id, `replaced-${verdict}`, { detach: true, was: row.solution_pdf ?? "" });
      out.replaced.push(row.title);
    } catch (e) {
      out.failed.push(`${row.title}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }

  const { data: after } = await svc.from("sections").select(SELECT).not("m_paper_solution_pdf", "is", null).limit(500);
  out.remaining = ((after ?? []) as unknown as Row[])
    .filter((r) => String(r.solution_pdf ?? "").trim() && !r.audit).length;
  return out;
}

async function stamp(
  svc: ReturnType<typeof createServiceClient>,
  sectionId: string,
  verdict: string,
  opts: { detach?: boolean; was?: string } = {},
) {
  const { data } = await svc.from("sections").select("config").eq("id", sectionId).maybeSingle();
  const cfg = { ...((data?.config ?? {}) as Record<string, unknown>) };
  cfg.solution_audit = verdict;
  if (opts.detach) {
    cfg.paper_solution_pdf = null;
    cfg.replaced_student_copy = opts.was ?? null; // kept so it can be traced
  }
  await svc.from("sections").update({ config: cfg }).eq("id", sectionId);
}

// ── DOES EACH KEY ANSWER ITS OWN PAPER? ───────────────────────────────────
//
// The audit above asks whether a solution is typeset or a handwritten scan. It
// never asks whether it is the solution to THIS paper — and that is the fault
// that actually reached a student. She sat the cash flow test, answered it, and
// the marker reported that she had answered none of the questions, because the
// marker is only ever shown the answer book and the key. It cannot see the
// question paper, so a key belonging to another test looks exactly like a
// student who wrote nonsense.
//
// This walks every descriptive test that has BOTH a question paper and a key
// and records the verdict on the section. Nothing is detached and no mark is
// changed: a wrong key is a judgement about teaching material, and it goes in
// front of a person. What it does guarantee is that the question is asked at
// all, which until now it never was.

export type KeyMatchResult = {
  checked: number;
  matched: string[];
  /** The key belongs to another paper — everyone who sits this scores near zero. */
  mismatched: { title: string; id: string; note: string }[];
  /** The key is for this paper but stops short of some questions. */
  incomplete: { title: string; id: string; note: string }[];
  unclear: { title: string; note: string }[];
  remaining: number;
};

export async function auditKeyMatchesPaper(limit = 6, budgetMs = 230_000, recheck = false): Promise<KeyMatchResult> {
  const { classifyKeyMatchesPaper } = await import("@/lib/ai");
  const svc = createServiceClient();
  const started = Date.now();
  const out: KeyMatchResult = { checked: 0, matched: [], mismatched: [], incomplete: [], unclear: [], remaining: 0 };

  const SEL =
    "id, title, question_pdf:config->>paper_question_pdf, solution_pdf:config->>paper_solution_pdf, " +
    "key_match:config->>key_match";
  const { data } = await svc
    .from("sections").select(SEL)
    .not("m_paper_solution_pdf", "is", null)
    .not("m_paper_question_pdf", "is", null)
    .limit(500);

  type R = { id: string; title: string; question_pdf: string | null; solution_pdf: string | null; key_match: string | null };
  const all = ((data ?? []) as unknown as R[])
    .filter((r) => String(r.solution_pdf ?? "").trim() && String(r.question_pdf ?? "").trim());
  // "unclear" is re-tried on a later pass; a settled match or mismatch is not.
  const todo = all.filter((r) => recheck || !r.key_match || r.key_match.startsWith("unclear"));
  out.remaining = todo.length;

  for (const row of todo.slice(0, limit)) {
    if (Date.now() - started > budgetMs) break;
    try {
      const [qUrl, sUrl] = await Promise.all([
        resolveFileUrl(row.question_pdf as string, 900),
        resolveFileUrl(row.solution_pdf as string, 900),
      ]);
      if (!qUrl || !sUrl) {
        out.unclear.push({ title: row.title, note: "a file could not be opened" });
        continue;
      }
      const { verdict, note } = await classifyKeyMatchesPaper(qUrl, sUrl);
      out.checked++;
      await stampMatch(svc, row.id, verdict, note);
      if (verdict === "match") out.matched.push(row.title);
      else if (verdict === "mismatch") out.mismatched.push({ title: row.title, id: row.id, note });
      else if (verdict === "incomplete") out.incomplete.push({ title: row.title, id: row.id, note });
      else out.unclear.push({ title: row.title, note });
    } catch (e) {
      out.unclear.push({ title: row.title, note: e instanceof Error ? e.message : "failed" });
    }
  }

  const { data: after } = await svc.from("sections").select(SEL)
    .not("m_paper_solution_pdf", "is", null).not("m_paper_question_pdf", "is", null).limit(500);
  out.remaining = ((after ?? []) as unknown as R[])
    .filter((r) => String(r.solution_pdf ?? "").trim() && String(r.question_pdf ?? "").trim())
    .filter((r) => !r.key_match || r.key_match.startsWith("unclear")).length;
  return out;
}

async function stampMatch(
  svc: ReturnType<typeof createServiceClient>,
  sectionId: string,
  verdict: string,
  note: string,
) {
  const { data } = await svc.from("sections").select("config").eq("id", sectionId).maybeSingle();
  const cfg = { ...((data?.config ?? {}) as Record<string, unknown>) };
  cfg.key_match = verdict;
  cfg.key_match_note = note;
  cfg.key_match_at = new Date().toISOString();
  await svc.from("sections").update({ config: cfg }).eq("id", sectionId);
}

// ── PAPERS WHOSE KEY WAS WRITTEN BY US, NOT UPLOADED ──────────────────────
//
// Fifty-one tests have no uploaded solution: their key was drafted from the
// question paper and approved, and every Financial Reporting paper is one of
// them. A key written from the paper cannot belong to a different paper, so the
// wrong-file fault cannot occur there. What can occur — and costs a student the
// same marks — is a key that stops after Q2 of a three-question paper.
export async function auditDraftedKeys(limit = 6, budgetMs = 230_000, recheck = false): Promise<KeyMatchResult> {
  const { classifyKeyTextCoversPaper } = await import("@/lib/ai");
  const svc = createServiceClient();
  const started = Date.now();
  const out: KeyMatchResult = { checked: 0, matched: [], mismatched: [], incomplete: [], unclear: [], remaining: 0 };

  const { data } = await svc
    .from("sections")
    .select("id, title, question_pdf:config->>paper_question_pdf, key_match:config->>key_match")
    .not("m_paper_question_pdf", "is", null)
    .is("m_paper_solution_pdf", null)
    .limit(500);

  type R = { id: string; title: string; question_pdf: string | null; key_match: string | null };
  const all = ((data ?? []) as unknown as R[]).filter((r) => String(r.question_pdf ?? "").trim());
  const todo = all.filter((r) => recheck || !r.key_match || r.key_match.startsWith("unclear"));
  out.remaining = todo.length;

  for (const row of todo.slice(0, limit)) {
    if (Date.now() - started > budgetMs) break;
    try {
      const { data: sol } = await svc
        .from("item_solutions").select("solution_md").eq("section_id", row.id).maybeSingle();
      const keyText = String((sol as { solution_md?: string } | null)?.solution_md ?? "");
      if (!keyText.trim()) {
        out.unclear.push({ title: row.title, note: "this test has no key at all" });
        await stampMatch(svc, row.id, "unclear", "no key to compare");
        continue;
      }
      const qUrl = await resolveFileUrl(row.question_pdf as string, 900);
      if (!qUrl) {
        out.unclear.push({ title: row.title, note: "the question paper could not be opened" });
        continue;
      }
      const { verdict, note } = await classifyKeyTextCoversPaper(qUrl, keyText);
      out.checked++;
      await stampMatch(svc, row.id, verdict, note);
      if (verdict === "match") out.matched.push(row.title);
      else if (verdict === "mismatch") out.mismatched.push({ title: row.title, id: row.id, note });
      else if (verdict === "incomplete") out.incomplete.push({ title: row.title, id: row.id, note });
      else out.unclear.push({ title: row.title, note });
    } catch (e) {
      out.unclear.push({ title: row.title, note: e instanceof Error ? e.message : "failed" });
    }
  }

  const { data: after } = await svc.from("sections")
    .select("id, question_pdf:config->>paper_question_pdf, key_match:config->>key_match")
    .not("m_paper_question_pdf", "is", null).is("m_paper_solution_pdf", null).limit(500);
  out.remaining = ((after ?? []) as unknown as R[])
    .filter((r) => String(r.question_pdf ?? "").trim())
    .filter((r) => !r.key_match || r.key_match.startsWith("unclear")).length;
  return out;
}

// ── PUTTING THE BAD ONES RIGHT ────────────────────────────────────────────
//
// A key that answers another paper, or stops halfway through this one, is
// marking students today. The question paper is the thing we can trust — it is
// what the student actually sat — so the answer is written from that, the same
// way it is written for the fifty-one tests that never had a key.
//
// The wrong file is DETACHED, not deleted. It is a real document that belongs
// to some other paper, and finding out which one is a job for a person; losing
// it would make that impossible.
export type RepairResult = {
  repaired: { title: string; was: string }[];
  failed: { title: string; why: string }[];
  remaining: number;
};

export async function repairBadKeys(limit = 4, budgetMs = 230_000): Promise<RepairResult> {
  const { draftSolutionFromPdf } = await import("@/lib/ai");
  const svc = createServiceClient();
  const started = Date.now();
  const out: RepairResult = { repaired: [], failed: [], remaining: 0 };

  const SEL =
    "id, title, question_pdf:config->>paper_question_pdf, solution_pdf:config->>paper_solution_pdf, " +
    "marks:config->>paper_total_marks, verdict:config->>key_match, topics(subjects(title))";
  const { data } = await svc.from("sections").select(SEL).not("m_paper_question_pdf", "is", null).limit(500);
  type R = {
    id: string; title: string; question_pdf: string | null; solution_pdf: string | null;
    marks: string | null; verdict: string | null; topics: { subjects: { title: string } | null } | null;
  };
  const bad = ((data ?? []) as unknown as R[])
    .filter((r) => r.verdict === "mismatch" || r.verdict === "incomplete")
    .filter((r) => String(r.question_pdf ?? "").trim());
  out.remaining = bad.length;

  for (const row of bad.slice(0, limit)) {
    if (Date.now() - started > budgetMs) break;
    try {
      const qUrl = await resolveFileUrl(row.question_pdf as string, 900);
      if (!qUrl) { out.failed.push({ title: row.title, why: "the question paper could not be opened" }); continue; }

      const text = await draftSolutionFromPdf({
        paperTitle: row.title,
        subject: row.topics?.subjects?.title ?? "",
        questionPdfUrl: qUrl,
        totalMarks: Number(row.marks) || null,
      });
      if (!text) { out.failed.push({ title: row.title, why: "a replacement key could not be written" }); continue; }

      const { data: existing } = await svc
        .from("item_solutions").select("id").eq("section_id", row.id).maybeSingle();
      const payload = {
        section_id: row.id,
        solution_md: text,
        status: "approved",
        parts: 1,
        generated_at: new Date().toISOString(),
        approved_at: new Date().toISOString(),
        error: null,
      };
      if (existing?.id) await svc.from("item_solutions").update(payload).eq("id", existing.id);
      else await svc.from("item_solutions").insert(payload);

      // Any marking guide built from the old key is now wrong too — it is the
      // compact ladder every student's copy is marked against, so leaving it in
      // place would keep the fault alive after the key was replaced.
      await svc.from("marking_schemes").delete().eq("section_id", row.id);

      const { data: cur } = await svc.from("sections").select("config").eq("id", row.id).maybeSingle();
      const cfg = { ...((cur?.config ?? {}) as Record<string, unknown>) };
      const was = String(row.solution_pdf ?? "");
      if (was) { cfg.paper_solution_pdf = null; cfg.replaced_wrong_key = was; }
      cfg.key_match = "repaired";
      cfg.key_match_note = `A key was written from this paper's own question paper on ${new Date().toISOString().slice(0, 10)}` +
        (was ? ", and the document that did not belong to it was detached (kept on record)." : ".");
      cfg.key_match_at = new Date().toISOString();
      await svc.from("sections").update({ config: cfg }).eq("id", row.id);

      out.repaired.push({ title: row.title, was });
    } catch (e) {
      out.failed.push({ title: row.title, why: e instanceof Error ? e.message : "failed" });
    }
  }

  const { data: after } = await svc.from("sections").select(SEL).not("m_paper_question_pdf", "is", null).limit(500);
  out.remaining = ((after ?? []) as unknown as R[])
    .filter((r) => r.verdict === "mismatch" || r.verdict === "incomplete").length;
  return out;
}
