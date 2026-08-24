import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import AnswerKey from "@/app/components/AnswerKey";

export const dynamic = "force-dynamic";
export const metadata = {
  // Its own address, so it is not read as a copy of the home page.
  alternates: { canonical: "/mock-tests" },
  title: "CA Intermediate mock tests — September 2026",
  description:
    "Free full-length mock test papers for CA Intermediate Advanced Accounting, September 2026 — 100 marks in the ICAI pattern. Write it, send it in, get it back checked.",
};

// The mock papers, for anybody with an account.
//
// The founder's shape: log in, download the paper, write it by hand, send it
// back, get it checked. No plan, nothing else on the page. So the answers are
// NOT here — a student who can read the suggested answers beside the question
// paper has not sat a mock test, they have read a solved paper, and the three
// hours were the point.
export default async function MockTestsPage(props: {
  searchParams: Promise<{ paper?: string }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const svc = createServiceClient();
  const { data } = await svc
    .from("mock_papers")
    .select("id, course, subject, attempt_label, paper_no, title, total_marks, duration_min, questions_md")
    .eq("status", "approved")
    .order("course")
    .order("paper_no");
  const papers = (data ?? []) as {
    id: string; course: string; subject: string; attempt_label: string; paper_no: number;
    title: string; total_marks: number; duration_min: number; questions_md: string | null;
  }[];

  // Papers not yet live but with an announced date — shown as "coming on <date>"
  // so students know the schedule instead of a bare "coming soon". Approval is
  // still what makes a paper actually openable; this is only the announcement.
  const { data: upData } = await svc
    .from("mock_papers")
    .select("id, course, subject, attempt_label, paper_no, title, publish_on")
    .neq("status", "approved")
    .not("publish_on", "is", null)
    .order("publish_on");
  const upcoming = (upData ?? []) as {
    id: string; course: string; subject: string; attempt_label: string; paper_no: number; title: string; publish_on: string;
  }[];
  const fmtDate = (d: string) =>
    new Date(`${d}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  const open = searchParams.paper ? papers.find((p) => p.id === searchParams.paper) : null;

  // Reading a paper needs an account — that is the only gate, and it exists so
  // the checked copy can come back to the right person.
  //
  // A silent bounce to /login looks like the site is broken, so a visitor who is
  // not signed in is SHOWN the paper's name and told plainly why the download is
  // asking them to log in first.
  const locked = Boolean(open) && !user;

  return (
    <main>
      <section className="container" style={{ paddingTop: 36, paddingBottom: 60, maxWidth: 820 }}>
        <span className="badge">📅 September 2026</span>
        <h1 style={{ margin: "12px 0 8px" }}>CA Intermediate mock tests</h1>
        <p className="muted" style={{ fontSize: "1rem", lineHeight: 1.7 }}>
          Full 100-mark papers in the ICAI pattern — <strong>30 marks of case-scenario MCQs</strong> and{" "}
          <strong>70 marks descriptive</strong>, set from the pattern of past exam questions. Sit it properly: three
          hours, no notes, write it by hand.
        </p>
        <p className="muted" style={{ fontSize: ".92rem" }}>
          Then send it in and it is checked against <strong>CA Parveen Sharma&apos;s own answer key</strong>, with the
          marks written on your own pages — <strong>back to you within 24 hours, guaranteed</strong>. No plan needed.
        </p>

        {open ? (
          <>
            <p className="crumb" style={{ marginTop: 20 }}><Link href="/mock-tests">← All mock papers</Link></p>
            <div className="card" style={{ marginTop: 8 }}>
              <strong style={{ fontSize: "1.05rem" }}>{open.title}</strong>
              <p className="muted" style={{ fontSize: ".85rem", margin: "4px 0 0" }}>
                Time allowed {Math.round(open.duration_min / 60)} hours · Maximum marks {open.total_marks}
              </p>
              {locked ? (
                <>
                  <div className="notice" style={{ marginTop: 12 }}>
                    🔒 Please log in before you download this paper. It takes a moment, and it is what lets us send
                    your checked copy back to you afterwards.
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                    {/* The login page carries "Create account" inside it, so one
                        button serves the student who has an account and the one
                        who does not. */}
                    <Link className="btn" href={`/login?next=/mock-tests?paper=${open.id}`}>
                      🔑 Log in and download the paper
                    </Link>
                  </div>
                  <p className="muted" style={{ fontSize: ".82rem", marginTop: 10 }}>
                    No account yet? Creating one is free and takes a minute — tap the button and choose
                    &ldquo;Create account&rdquo;.
                  </p>
                </>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                    <a className="btn" href={`/mock-tests/${open.id}/pdf`} target="_blank" rel="noopener noreferrer">
                      📄 Download the paper (PDF)
                    </a>
                    <Link className="btn secondary" href="/check-my-paper">📤 I have written it — send it for checking</Link>
                  </div>
                  <p className="muted" style={{ fontSize: ".82rem", marginTop: 10 }}>
                    Print the PDF and sit it properly — three hours, no notes, written by hand. Scan the whole answer
                    book as ONE PDF when you are done and send it in.
                  </p>
                </>
              )}
            </div>
            {/* The questions themselves are part of the paper — never shown to
                somebody who has not logged in. */}
            {!locked && (
              <details className="card" style={{ marginTop: 12 }}>
                <summary style={{ cursor: "pointer", fontWeight: 700 }}>Read it on screen instead</summary>
                <AnswerKey text={open.questions_md ?? ""} size=".8rem" />
              </details>
            )}
          </>
        ) : (
          <>
            {papers.length > 0 && (
              <div style={{ display: "grid", gap: 12, marginTop: 20 }}>
                {papers.map((p) => (
                  <Link key={p.id} href={`/mock-tests?paper=${p.id}`} className="card" style={{ display: "block", textDecoration: "none" }}>
                    <strong>📄 Mock Test Paper {p.paper_no} — {p.subject}</strong>
                    <p className="muted" style={{ fontSize: ".85rem", margin: "4px 0 0" }}>
                      {p.course} · {p.attempt_label} · {p.total_marks} marks · {Math.round(p.duration_min / 60)} hours
                      {!user ? " · log in to open" : ""}
                    </p>
                  </Link>
                ))}
              </div>
            )}

            {/* Announced-but-not-yet-live papers — a dated placeholder so a
                student knows exactly when it opens, not a bare "coming soon". */}
            {upcoming.length > 0 && (
              <div style={{ display: "grid", gap: 12, marginTop: papers.length > 0 ? 14 : 20 }}>
                {papers.length === 0 && (
                  <p className="muted" style={{ fontSize: ".9rem", margin: 0 }}>
                    The papers are on the way — here is when each one arrives. Each opens on its date.
                  </p>
                )}
                {upcoming.map((u) => (
                  <div key={u.id} className="card" style={{ opacity: 0.9, borderStyle: "dashed" }}>
                    <strong>📄 Mock Test Paper {u.paper_no} — {u.subject}</strong>
                    <p className="muted" style={{ fontSize: ".85rem", margin: "4px 0 0" }}>
                      {u.course} · {u.attempt_label} · 🕒 <strong>coming on {fmtDate(u.publish_on)}</strong>
                    </p>
                  </div>
                ))}
              </div>
            )}

            {papers.length === 0 && upcoming.length === 0 && (
              <div className="card" style={{ marginTop: 20 }}>
                <p className="muted">
                  The September 2026 papers are being finalised and will be here shortly. In the meantime you can send in
                  any paper you have written — <Link href="/check-my-paper">get it checked free</Link>.
                </p>
              </div>
            )}
          </>
        )}

        <p className="muted" style={{ fontSize: ".85rem", marginTop: 26 }}>
          Want the classes and the day-by-day plan behind these papers?{" "}
          <Link href="/courses">See the courses</Link>.
        </p>
      </section>
    </main>
  );
}
