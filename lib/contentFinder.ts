import { createServiceClient } from "@/lib/supabase/service";

// FIND THE THING THEY ASKED FOR, AND GIVE THE LINK TO IT.
//
// "Please provide mock test pdf", "Cab you share pdf for hitlist", "link for
// case law" — students ask for a file, but the answer is a page. Nothing needs
// downloading and sending: the papers already have their own pages, and the
// hitlist is a list of question numbers, not a document.
//
// So a question that names something we hold gets the real link. Only items a
// student is allowed to open are offered — the 88 ICAI uploads feed the answer
// but are not student-visible, and offering a link to one would be a locked
// door with our name on it.
//
// Nothing here invents. If the search finds nothing, it returns nothing, and
// the answer has to say we do not have it.

type Item = {
  id: string;
  kind: string;
  title: string;
  subject_id: string | null;
};

const KIND_WORDS: { kind: string; words: RegExp }[] = [
  { kind: "rtp", words: /\brtp\b|revision test paper/i },
  { kind: "mtp", words: /\bmtp\b|mock test|mock paper|mock/i },
  { kind: "past_papers", words: /past paper|previous paper|question paper|past exam|previous year|\bpyq\b/i },
  { kind: "question_bank", words: /question bank|\bqb\b|practice question/i },
  { kind: "notes", words: /\bnotes?\b/i },
];

const WANTS_HITLIST = /hit\s*-?\s*list|hitlist|most important question|important question|\bmiq\b/i;

/** "may 2025", "sept 2025", "jan 26" → a loose matcher against paper titles. */
function attemptWords(q: string): string[] {
  const out: string[] = [];
  const re = /\b(jan(?:uary)?|may|jun(?:e)?|sep(?:t|tember)?|nov(?:ember)?|dec(?:ember)?)\s*'?\s*(\d{2,4})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q))) {
    const month = m[1].toLowerCase().slice(0, 3);
    const year = m[2].length === 2 ? `20${m[2]}` : m[2];
    out.push(`${month}|${year}`);
  }
  return out;
}

function titleMatchesAttempt(title: string, wants: string[]): boolean {
  if (!wants.length) return true;
  const t = title.toLowerCase();
  return wants.some((w) => {
    const [month, year] = w.split("|");
    return t.includes(year) && t.includes(month);
  });
}

/**
 * What we hold that answers this message, as lines the AI can quote.
 * Returns "" when the question names nothing we stock — which is the signal
 * to answer from the material instead.
 */
export async function findContent(question: string): Promise<string> {
  const q = (question ?? "").trim();
  if (!q) return "";

  const kinds = KIND_WORDS.filter((k) => k.words.test(q)).map((k) => k.kind);
  const wantsHitlist = WANTS_HITLIST.test(q);
  if (!kinds.length && !wantsHitlist) return "";

  const svc = createServiceClient();
  const blocks: string[] = [];

  // ── Papers and notes ─────────────────────────────────────────────────────
  if (kinds.length) {
    const { data } = await svc
      .from("repository_items")
      .select("id, kind, title, subject_id")
      .in("kind", kinds)
      .eq("is_active", true)
      .eq("student_visible", true)
      .limit(120);

    const items = (data ?? []) as Item[];
    const wants = attemptWords(q);
    const matched = items.filter((i) => titleMatchesAttempt(i.title, wants));
    // A named attempt that matches nothing falls back to the whole set, so
    // "RTP May 2019" answers with the RTPs we do have rather than silence.
    const use = matched.length ? matched : items;

    if (use.length) {
      const names = await subjectNames(svc, use.map((i) => i.subject_id));
      const lines = use.slice(0, 20).map((i) => {
        const where = names.get(i.subject_id ?? "") ?? { course: "", subject: "" };
        // Papers open on their own page, where the student can attempt them and
        // have the answer checked. Notes and banks open the file directly.
        const link = ["rtp", "mtp", "past_papers"].includes(i.kind)
          ? `/learn/paper/${i.id}`
          : "/dashboard";
        return `  ${where.course} · ${where.subject} — "${i.title}" → ${link}`;
      });
      blocks.push(
        `PAPERS AND MATERIAL WE HOLD that match this question (give the link; never attach a file):\n${lines.join("\n")}` +
          (matched.length === 0 && wants.length
            ? "\nThe exact attempt they named is NOT in the list above — say so, and offer these."
            : ""),
      );
    } else {
      blocks.push("We hold nothing matching that request. Say so plainly.");
    }
  }

  // ── The hitlist ──────────────────────────────────────────────────────────
  // The hitlist is the list of important TOPICS for an attempt, with expected
  // marks, uploaded as a PDF. It is NOT subjects.miq_rev1, which is the
  // most-important-QUESTIONS list — a different list for a different purpose.
  // Reading one as the other would point a student at the wrong revision.
  if (wantsHitlist) {
    const { data } = await svc
      .from("repository_items")
      .select("title, valid_from_attempt, subjects(title, courses(title))")
      .eq("is_active", true)
      .eq("student_visible", true)
      .or("title.ilike.%hitlist%,title.ilike.%hit list%")
      .order("created_at", { ascending: false });

    // The embedded relations come back as an array or an object depending on
    // how the relationship is read; flattened here so the rest is plain.
    const one = <T,>(v: T | T[] | null): T | undefined => (Array.isArray(v) ? v[0] : v ?? undefined);
    const rows = ((data ?? []) as unknown as {
      title: string; valid_from_attempt: string | null;
      subjects: { title: string; courses: { title: string } | { title: string }[] | null }
              | { title: string; courses: { title: string } | { title: string }[] | null }[] | null;
    }[]).map((r) => {
      const subj = one(r.subjects);
      return {
        title: r.title,
        attempt: r.valid_from_attempt ?? "",
        subject: subj?.title ?? "",
        course: one(subj?.courses ?? null)?.title ?? "",
      };
    });

    // Which subjects have one, and which do not — read from the data, so the
    // answer stays right the day another is uploaded.
    const { data: allSubj } = await svc
      .from("subjects").select("title, courses(title)").order("order_index");
    const every = ((allSubj ?? []) as unknown as {
      title: string; courses: { title: string } | { title: string }[] | null;
    }[]).map((r) => ({
      subject: r.title,
      course: (Array.isArray(r.courses) ? r.courses[0]?.title : r.courses?.title) ?? "",
    }));
    const covered = new Set(rows.map((r) => `${r.course}|${r.subject}`));
    const missing = every.filter((e) => !covered.has(`${e.course}|${e.subject}`));

    blocks.push(
      "THE HITLIST is CA Parveen Sharma's list of the important TOPICS for an exam, with the marks " +
        "each is expected to carry. It is NOT the most-important-questions list — do not describe it " +
        "as question numbers. It opens at /learn/hitlist; send that link rather than a file.\n" +
        (rows.length
          ? `  Released: ${rows.map((r) => `${r.course} — ${r.subject} (${r.attempt || "attempt not stated"})`).join("; ")}\n`
          : "  Not released for any subject yet.\n") +
        (missing.length
          ? `  NOT released yet for: ${missing.map((m) => `${m.course} — ${m.subject}`).join("; ")}\n`
          : "") +
        "  If you cannot tell which course they are on, ASK — one short question, e.g. " +
        "'Are you doing CA Final or CA Intermediate?' — rather than guessing.",
    );
  }

  return blocks.join("\n\n");
}

async function subjectNames(
  svc: ReturnType<typeof createServiceClient>,
  ids: (string | null)[],
): Promise<Map<string, { course: string; subject: string }>> {
  const wanted = [...new Set(ids.filter(Boolean))] as string[];
  const out = new Map<string, { course: string; subject: string }>();
  if (!wanted.length) return out;
  const { data } = await svc.from("subjects").select("id, title, courses(title)").in("id", wanted);
  for (const r of (data ?? []) as unknown as {
    id: string; title: string; courses: { title: string } | { title: string }[] | null;
  }[]) {
    const course = (Array.isArray(r.courses) ? r.courses[0]?.title : r.courses?.title) ?? "";
    out.set(r.id, { course, subject: r.title });
  }
  return out;
}
