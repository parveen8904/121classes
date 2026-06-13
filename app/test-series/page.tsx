import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type CourseRow = { id: string; title: string; subjects: { id: string; title: string }[] };

export default async function TestSeriesPage() {
  const supabase = createClient();
  const { data } = await supabase
    .from("courses")
    .select("id, title, subjects(id, title)")
    .eq("is_published", true)
    .eq("is_test_series", true)
    .order("order_index");

  const series = (data ?? []) as unknown as CourseRow[];

  return (
    <section className="section">
      <div className="section-head">
        <span className="eyebrow">📝 Test Series</span>
        <h2>Test series</h2>
        <p>Exam-style mock papers with feedback — practise like the real thing, attempt after attempt.</p>
      </div>

      {series.length > 0 ? (
        <div className="grid grid-3">
          {series.map((s) => (
            <div className="tile" key={s.id}>
              <div className="ic">📝</div>
              <h3>{s.title}</h3>
              <p className="muted" style={{ fontSize: ".88rem", marginTop: 8 }}>
                {(s.subjects ?? []).length} paper set{(s.subjects ?? []).length === 1 ? "" : "s"}
              </p>
              <p style={{ marginTop: 14 }}>
                <Link className="btn small" href="/login">
                  Enrol / view →
                </Link>
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted" style={{ textAlign: "center" }}>📭 Test series are being prepared — check back soon.</p>
      )}
    </section>
  );
}
