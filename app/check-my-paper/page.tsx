import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { viaProxy } from "@/lib/fileProxy";
import PaperUpload from "./PaperUpload";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Get your paper checked — CA Parveen Sharma",
  description:
    "Send your handwritten answer book and get it back marked against CA Parveen Sharma's own answer key, with the marks written on your own pages. Free — no plan needed.",
};

// Open to everybody with an account, paid or not.
//
// The founder's reason: a student runs out of time on the portal, or has no
// plan at all, and there is nowhere to send an answer book. So: log in, say
// which test, upload the PDF, and it comes back checked by email. Nothing else
// is shown — this page is not the portal and does not try to be.
//
// It is NOT a separate marking system. It creates a real attempt on a real
// test, so the paper goes through the same key, the same step marking guide and
// the same examiner as a paying student's. That is the point of asking which
// test it is.
export default async function CheckMyPaperPage(props: {
  searchParams: Promise<{ sent?: string; err?: string }>;
}) {
  const searchParams = await props.searchParams;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/check-my-paper");

  const svc = createServiceClient();
  const { data: profile } = await svc.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle();

  // Only tests that can actually be marked — one with no approved key has
  // nothing to mark against, and offering it would promise something we cannot
  // do.
  const { data: rows } = await svc.rpc("list_checkable_tests");
  const tests = ((rows ?? []) as { id: string; title: string; course: string; subject: string }[]);

  const { data: mine } = await svc
    .from("descriptive_attempts")
    .select("id, section_id, submitted_at, review_status, awarded_marks, total_marks, annotated_url, status")
    .eq("student_id", user.id)
    .eq("source", "paper_check")
    .order("submitted_at", { ascending: false })
    .limit(20);

  const titleById = new Map(tests.map((t) => [t.id, t.title]));

  return (
    <main>
      <section className="container" style={{ paddingTop: 36, paddingBottom: 60, maxWidth: 720 }}>
        <span className="badge">📝 Paper checking</span>
        <h1 style={{ margin: "12px 0 8px" }}>Get your answer book checked</h1>
        <p className="muted" style={{ fontSize: "1rem", lineHeight: 1.7 }}>
          Written a paper by hand and want it marked properly? Send it here. It is checked against{" "}
          <strong>CA Parveen Sharma&apos;s own approved answer key</strong> for that test, with the marks written on
          your own pages and a summary at the end — then a faculty member verifies it and we email it back to you,
          usually within a couple of hours.
        </p>
        <p className="muted" style={{ fontSize: ".9rem" }}>
          <strong>Free, and no plan needed.</strong> You only need an account so the copy comes back to the right
          person.
        </p>

        {searchParams.sent && (
          <div className="notice ok" style={{ marginTop: 16 }}>
            ✅ Your paper is with us. It is being checked now — we will email you as soon as the faculty release it.
            You can close this page.
          </div>
        )}
        {searchParams.err && <div className="notice err" style={{ marginTop: 16 }}>{searchParams.err}</div>}

        {tests.length === 0 ? (
          <div className="card" style={{ marginTop: 16 }}>
            <p className="muted">No tests are open for checking at the moment. Please try again shortly.</p>
          </div>
        ) : (
          <PaperUpload tests={tests} name={(profile?.full_name as string) ?? ""} />
        )}

        {(mine ?? []).length > 0 && (
          <div style={{ marginTop: 28 }}>
            <h2 style={{ fontSize: "1.1rem" }}>📨 Papers you have sent</h2>
            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              {(mine ?? []).map((a) => {
                const released = a.review_status === "checked" && a.awarded_marks != null;
                return (
                  <div className="card" key={a.id as string}>
                    <strong>{titleById.get(a.section_id as string) ?? "Descriptive test"}</strong>
                    <p className="muted" style={{ fontSize: ".85rem", margin: "4px 0 0" }}>
                      {released
                        ? `Marks: ${a.awarded_marks}${a.total_marks ? ` / ${a.total_marks}` : ""}`
                        : "⏳ Being checked — we will email you when it is ready."}
                      {a.submitted_at ? ` · sent ${new Date(a.submitted_at as string).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : ""}
                    </p>
                    {released && a.annotated_url && (
                      <a className="btn small" style={{ marginTop: 8 }} href={viaProxy(a.annotated_url as string)} target="_blank" rel="noopener noreferrer">
                        📝 Open my checked copy + official answers
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <p className="muted" style={{ fontSize: ".85rem", marginTop: 26 }}>
          Want the whole thing — classes, day-by-day plan, unlimited tests and doubts?{" "}
          <Link href="/courses">See the courses</Link>.
        </p>
      </section>
    </main>
  );
}
