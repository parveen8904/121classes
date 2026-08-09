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

// "please provide demo classes" was answered with "we have no demo videos".
// We give five free classes in every subject and always have — they are the
// classes with no plan required on them. Nothing told the AI that, so it
// invented an absence, which is the one thing worse than inventing a link.
const WANTS_DEMO = /\bdemo\b|trial class|free class|sample class|sample lecture|free lecture|try the class/i;

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
  const wantsDemo = WANTS_DEMO.test(q);
  if (!kinds.length && !wantsHitlist && !wantsDemo) return "";

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

  // ── Free demo classes ────────────────────────────────────────────────────
  if (wantsDemo) {
    // Counted from the classes themselves, so the number is never a claim we
    // have stopped honouring. A free demo is a published class with no plan
    // required on it.
    const counts = await freeDemoCounts(svc);
    blocks.push(
      counts.length
        ? "FREE DEMO CLASSES — we give the first classes of every subject free. Anyone can create a " +
          "free account and watch them; no payment and no card.\n" +
          counts.map((c) => `  ${c.course} · ${c.subject} — ${c.free} free classes (of ${c.total})`).join("\n") +
          "\n  They open from the subject page under /courses, after signing in. Say the number plainly."
        : "We do not currently have free demo classes to offer. Say so plainly.",
    );
  }

  return blocks.join("\n\n");
}

/** How many classes in each subject are free to watch without a plan. */
async function freeDemoCounts(
  svc: ReturnType<typeof createServiceClient>,
): Promise<{ course: string; subject: string; free: number; total: number }[]> {
  try {
    const { data } = await svc
      .from("sections")
      .select("min_plan, is_published, type, topics!inner(subjects!inner(title, courses!inner(title)))")
      .eq("type", "full_class_video")
      .eq("is_published", true)
      .limit(2000);

    const rows = (data ?? []) as unknown as {
      min_plan: string | null;
      topics: { subjects: { title: string; courses: { title: string } } };
    }[];

    const tally = new Map<string, { course: string; subject: string; free: number; total: number }>();
    for (const r of rows) {
      const subject = r.topics?.subjects?.title ?? "";
      const course = r.topics?.subjects?.courses?.title ?? "";
      if (!subject) continue;
      const key = `${course}|${subject}`;
      const cur = tally.get(key) ?? { course, subject, free: 0, total: 0 };
      cur.total += 1;
      if (r.min_plan == null) cur.free += 1;
      tally.set(key, cur);
    }
    return [...tally.values()].filter((t) => t.free > 0);
  } catch {
    return [];
  }
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
