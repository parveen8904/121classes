import Link from "next/link";
import AdminHero from "../../_components/AdminHero";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Repository overview — Admin" };

type Sec = {
  topic_id: string; type: string; class_no: string | null; pdf_url: string | null;
  notes_hand_url: string | null; notes_typed_url: string | null; has_transcript: boolean;
};

const has = (v: unknown) => !!(v && String(v).trim());

export default async function RepositoryOverview() {
  const svc = createServiceClient();
  const [{ data: subjects }, { data: topics }] = await Promise.all([
    svc.from("subjects").select("id, title, order_index").order("order_index").order("title"),
    svc
      .from("topics")
      .select("id, title, subject_id, is_combined, weightage_marks, important_qs_rev1, important_qs_rev2, book_pdf_url, icai_material_url, revision_video_url, revision_paper_url")
      .order("order_index"),
  ]);
  const topicIds = (topics ?? []).map((t) => t.id);
  const { data: secRows } = topicIds.length
    ? await svc.from("sections_meta").select("topic_id, type, class_no, pdf_url, notes_hand_url, notes_typed_url, has_transcript").in("topic_id", topicIds)
    : { data: [] as Sec[] };

  const secByTopic = new Map<string, Sec[]>();
  for (const s of (secRows ?? []) as Sec[]) {
    if (!secByTopic.has(s.topic_id)) secByTopic.set(s.topic_id, []);
    secByTopic.get(s.topic_id)!.push(s);
  }

  function stats(topicId: string, t: { is_combined: boolean; weightage_marks: number | null; important_qs_rev1: string | null; important_qs_rev2: string | null; book_pdf_url: string | null; revision_paper_url: string | null }) {
    const secs = secByTopic.get(topicId) ?? [];
    let classes = 0, pdfs = 0, transcripts = 0;
    for (const s of secs) {
      // Don't count "part" continuations (e.g. 7B) as separate classes.
      if (s.type === "full_class_video" && !/[A-Za-z]/.test(String(s.class_no ?? ""))) classes++;
      if (has(s.pdf_url)) pdfs++;
      if (has(s.notes_hand_url)) pdfs++;
      if (has(s.notes_typed_url)) pdfs++;
      if (s.has_transcript) transcripts++;
    }
    const missing: string[] = [];
    if (t.is_combined) {
      if (!has(t.book_pdf_url)) missing.push("subject book");
      if (!has(t.revision_paper_url)) missing.push("ICAI revision paper");
      if (secs.filter((s) => s.type === "mcq_test" || s.type === "subjective_test").length < 4) missing.push("4–5 mocks");
    } else {
      if (!classes) missing.push("classes");
      if (!transcripts) missing.push("transcripts");
      if (!t.weightage_marks) missing.push("weightage");
      if (!has(t.important_qs_rev1)) missing.push("1st-rev Qs");
      if (!has(t.important_qs_rev2)) missing.push("2nd-rev Qs");
    }
    return { classes, pdfs, transcripts, missing };
  }

  const topicsBySubject = new Map<string, typeof topics>();
  for (const t of topics ?? []) {
    if (!topicsBySubject.has(t.subject_id)) topicsBySubject.set(t.subject_id, [] as never);
    topicsBySubject.get(t.subject_id)!.push(t);
  }

  const th = { padding: "6px 8px", fontWeight: 600, textAlign: "left" as const };
  const td = { padding: "7px 8px", borderBottom: "1px solid var(--border,#eee)", verticalAlign: "top" as const };

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 980 }}>
      <AdminHero
        badge="📊 Repository overview"
        title="What's uploaded, what's missing"
        subtitle="Per topic: classes, PDFs and transcripts uploaded — and a red flag on anything still missing."
        back={{ href: "/admin/repository", label: "AI Repository" }}
      />

      {(subjects ?? []).map((subj) => {
        const list = topicsBySubject.get(subj.id) ?? [];
        if (!list.length) return null;
        return (
          <div key={subj.id} style={{ marginTop: 24 }}>
            <h2 style={{ fontSize: "1.1rem", marginBottom: 8 }}>{subj.title}</h2>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".88rem", minWidth: 720 }}>
                <thead>
                  <tr style={{ color: "var(--muted,#888)", borderBottom: "1px solid var(--border,#ddd)" }}>
                    <th style={th}>Topic</th>
                    <th style={th}>Classes</th>
                    <th style={th}>PDFs</th>
                    <th style={th}>Transcripts</th>
                    <th style={th}>Missing</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((t) => {
                    const s = stats(t.id, t);
                    return (
                      <tr key={t.id}>
                        <td style={td}>
                          <Link href={`/admin/topics/${t.id}`} style={{ color: "var(--accent)", fontWeight: 600 }}>
                            {t.is_combined ? "🧩 " : ""}{t.title}
                          </Link>
                        </td>
                        <td style={td}>{s.classes || "—"}</td>
                        <td style={td}>{s.pdfs || "—"}</td>
                        <td style={td}>{s.transcripts || "—"}</td>
                        <td style={td}>
                          {s.missing.length === 0 ? (
                            <span style={{ color: "#16a34a", fontWeight: 600 }}>✓ complete</span>
                          ) : (
                            <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                              {s.missing.map((m) => (
                                <span key={m} style={{ fontSize: ".75rem", background: "#fee2e2", color: "#b91c1c", padding: "2px 7px", borderRadius: 999 }}>
                                  {m}
                                </span>
                              ))}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </section>
  );
}
