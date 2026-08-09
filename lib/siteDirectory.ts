import { createServiceClient } from "@/lib/supabase/service";

// WHERE THINGS ARE, so a student asking "where is it?" gets an answer.
//
// A great many messages are not doubts at all. "Please provide mock test pdf",
// "where can I do free test series", "want to know about hitlist and mcq case
// study", "portal par class nahi aa rahi" — none of these are answerable from
// study material, so the AI declined every one of them and the student was
// told "our faculty will reply shortly". Then nothing came. A promise instead
// of an answer is worse than a slow answer.
//
// So the answering prompt gets a map of the site alongside the material. Every
// route here is one that actually exists — an invented link is worse than
// admitting we do not have the thing, because the student goes looking and
// finds a wall.
//
// The subject list is read from the database rather than typed, so a new
// subject appears here the day it is created.

const PLACES: { where: string; what: string }[] = [
  { where: "/dashboard", what: "The student's own home: their subjects, today's study target, and what is new." },
  { where: "/learn/downloads", what: "Classes downloaded to the phone for watching offline, inside the app." },
  { where: "/learn/hitlist", what: "The hitlist: the must-do question numbers, chapter by chapter, for their subjects. A page, not a PDF." },
  { where: "/learn/paper/<id>", what: "One RTP, MTP or past exam paper — attempt it there and have the answer checked." },
  { where: "/learn/performance", what: "Their own marks and progress across tests." },
  // Case scenarios and notes have no index page of their own — they are reached
  // from inside a course. Advertising /learn/cases sent students to a 404, which
  // is the one thing this map exists to prevent.
  { where: "/dashboard → your course", what: "Case scenarios, notes and materials for a subject: open the course from the dashboard, and they are listed inside it." },
  { where: "/mock-tests", what: "Mock test papers." },
  { where: "/test-series", what: "The test series." },
  { where: "/check-my-paper", what: "Upload a written answer copy to have it checked." },
  { where: "/planner", what: "The day-by-day study plan, built around their exam date." },
  { where: "/build-your-plan", what: "Make a study plan for the first time." },
  { where: "/calendar", what: "What is scheduled and when." },
  { where: "/live", what: "Live classes: what is coming, and joining links." },
  { where: "/amendments", what: "Amendments and updates that affect the syllabus." },
  { where: "/books", what: "Printed books, and how to order them." },
  { where: "/notifications", what: "Everything the student has been told, kept so nothing is missed." },
  { where: "/pricing", what: "Plans and what each includes." },
  { where: "/courses", what: "Every course and subject taught here." },
  { where: "/articles", what: "Articles and guidance written for CA students." },
  { where: "/career", what: "Career guidance, interviews and CV help." },
  { where: "/placements", what: "Job openings for CA students and freshers." },
  { where: "/results", what: "Results and rank-holders." },
  { where: "/support", what: "Raise a support ticket about the website, payment or access." },
  { where: "/help", what: "How to use the site." },
  { where: "/install", what: "Getting the mobile app." },
];

let cached: { text: string; until: number } | null = null;

/**
 * A short, factual description of what exists on the site and where.
 *
 * Kept deliberately compact: it rides in front of every answer, so a long map
 * would cost money on every doubt for detail nobody reads.
 */
export async function siteDirectory(): Promise<string> {
  if (cached && cached.until > Date.now()) return cached.text;

  let subjects = "";
  try {
    const svc = createServiceClient();
    const { data } = await svc.from("subjects").select("title, slug").order("order_index").limit(60);
    const list = (data ?? []) as { title: string; slug: string | null }[];
    if (list.length) {
      subjects =
        "\nSUBJECTS TAUGHT HERE: " +
        list.map((s) => s.title).join("; ") +
        ".\nA subject's classes are opened from the dashboard, or from /courses.";
    }
  } catch {
    // The map is still useful without the subject list.
  }

  const text =
    "WHERE THINGS ARE ON THE SITE (use these when a student asks where to find something — " +
    "give the page, and say plainly if we do not have what they named):\n" +
    PLACES.map((p) => `  ${p.where} — ${p.what}`).join("\n") +
    subjects;

  cached = { text, until: Date.now() + 60 * 60 * 1000 };
  return text;
}
