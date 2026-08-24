import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { viaProxy } from "@/lib/fileProxy";

export const dynamic = "force-dynamic";
export const metadata = { title: "The hitlist" };

// THE HITLIST — the topics worth the marks, with the marks they carry.
//
// It is CA Parveen Sharma's list of important TOPICS for a given attempt, each
// with its expected marks: "AS 14 [Amalgamation] 14", "AS 21 14", "AS 2 4". It
// is written for a particular exam and uploaded as a PDF.
//
// I first built this page around subjects.miq_rev1 — the most-important
// QUESTIONS list, question numbers chapter by chapter. That is a different
// thing with a different purpose, and showing it here under the name "hitlist"
// would send a student revising from the wrong list. The two are not
// interchangeable, so this page shows only the real one and says plainly when
// it has not been released rather than filling the space with the other.

type Uploaded = {
  id: string;
  subject_id: string;
  title: string;
  file_url: string | null;
  valid_from_attempt: string | null;
};

type Subject = { id: string; title: string; course_id: string };

export default async function HitlistPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/learn/hitlist");

  const svc = createServiceClient();

  // Only the subjects this student actually has.
  const { data: mine } = await supabase.from("my_subjects").select("subject_id");
  const ids = (mine ?? []).map((r) => String((r as { subject_id: string }).subject_id));

  const [{ data: subjRows }, { data: uploaded }] = await Promise.all([
    ids.length
      ? svc.from("subjects").select("id, title, course_id").in("id", ids).order("order_index")
      : Promise.resolve({ data: [] as Subject[] }),
    ids.length
      ? svc
          .from("repository_items")
          .select("id, subject_id, title, file_url, valid_from_attempt")
          .in("subject_id", ids)
          .eq("is_active", true)
          .eq("student_visible", true)
          .or("title.ilike.%hitlist%,title.ilike.%hit list%")
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as Uploaded[] }),
  ]);

  const subjects = (subjRows ?? []) as Subject[];
  const listFor = new Map<string, Uploaded[]>();
  for (const u of (uploaded ?? []) as Uploaded[]) {
    if (!u.file_url) continue;
    const arr = listFor.get(u.subject_id) ?? [];
    arr.push(u);
    listFor.set(u.subject_id, arr);
  }

  const withList = subjects.filter((s) => listFor.get(s.id)?.length);
  const without = subjects.filter((s) => !listFor.get(s.id)?.length);

  const courseIds = [...new Set(subjects.map((s) => s.course_id))];
  const { data: courseRows } = courseIds.length
    ? await svc.from("courses").select("id, title").in("id", courseIds)
    : { data: [] as { id: string; title: string }[] };
  const courseName = new Map((courseRows ?? []).map((c) => [c.id as string, c.title as string]));

  return (
    <main>
      <section className="container" style={{ paddingTop: 32, paddingBottom: 60, maxWidth: 760 }}>
        <p className="crumb"><Link prefetch={false} href="/dashboard">← Dashboard</Link></p>
        <span className="badge">🎯 The hitlist</span>
        <h1 style={{ margin: "12px 0 6px" }}>The topics that carry the marks</h1>
        <p className="muted" style={{ lineHeight: 1.7 }}>
          CA Parveen Sharma&rsquo;s list of the important topics for your exam, with the marks each
          one is expected to carry. It is written for a particular attempt, so use the one that
          matches yours.
        </p>

        {subjects.length === 0 && (
          <div className="card" style={{ marginTop: 20 }}>
            <p style={{ margin: 0 }}>
              You have no subjects yet. <Link href="/pricing">See the plans</Link> to get started.
            </p>
          </div>
        )}

        {withList.map((s) => (
          <div className="card" key={s.id} style={{ marginTop: 18 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <strong style={{ fontSize: "1.05rem" }}>{s.title}</strong>
              <span className="badge">{courseName.get(s.course_id) ?? ""}</span>
            </div>
            {(listFor.get(s.id) ?? []).map((u) => (
              <a
                key={u.id}
                href={viaProxy(u.file_url)}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "flex", gap: 12, alignItems: "center", marginTop: 12,
                  border: "2px solid var(--accent)", borderRadius: 12,
                  background: "var(--bg-soft)", padding: "12px 14px", color: "var(--text)",
                }}
              >
                <span style={{ fontSize: "1.6rem", lineHeight: 1 }}>📄</span>
                <span style={{ flex: 1 }}>
                  <strong style={{ fontSize: ".95rem" }}>{u.title}</strong>
                  {u.valid_from_attempt && (
                    <span className="muted" style={{ display: "block", fontSize: ".8rem" }}>
                      For the {u.valid_from_attempt} exam
                    </span>
                  )}
                </span>
                <span style={{ color: "var(--accent)", fontWeight: 700, fontSize: ".85rem" }}>Open →</span>
              </a>
            ))}
          </div>
        ))}

        {/* Said plainly rather than left blank — and never filled in with some
            other list to avoid an empty space. */}
        {without.length > 0 && (
          <p className="muted" style={{ marginTop: 20, fontSize: ".88rem", lineHeight: 1.7 }}>
            Not released yet for {without.map((s) => s.title).join(", ")}. It is written fresh for
            each attempt, so it follows the exam rather than the batch.
          </p>
        )}
      </section>
    </main>
  );
}
