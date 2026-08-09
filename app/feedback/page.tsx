import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import SubmitButton from "@/app/components/SubmitButton";
import { submitFeedback } from "./actions";
import { FEEDBACK_RATINGS, FEEDBACK_TEXT, SCALE } from "@/lib/feedbackQuestions";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Tell us what you think — CA Parveen Sharma",
  description: "Two minutes, ten questions. Tell us what is working and what is not.",
};

// ASKING, AND MEANING IT.
//
// Signing in is not required. The people worth hearing from most are often the
// ones who looked at the site and left, and a form that demands an account
// before it will listen never hears from them.
//
// What is signed in is filled in, so a student who has already told us their
// name is not asked for it a third time.

export default async function FeedbackPage(props: {
  searchParams: Promise<{ sent?: string; error?: string; from?: string }>;
}) {
  const sp = await props.searchParams;

  let name = "";
  let email = "";
  let phone = "";
  try {
    const { data: { user } } = await createClient().auth.getUser();
    if (user) {
      const { data: p } = await createServiceClient()
        .from("profiles").select("full_name, email, phone").eq("id", user.id).maybeSingle();
      name = (p?.full_name as string) ?? "";
      email = (p?.email as string) ?? user.email ?? "";
      phone = (p?.phone as string) ?? "";
    }
  } catch { /* a visitor fills it in themselves */ }

  if (sp.sent === "1") {
    return (
      <main>
        <section className="container" style={{ paddingTop: 48, paddingBottom: 80, maxWidth: 620 }}>
          <div className="card">
            <h1 style={{ marginTop: 0 }}>Thank you — that is genuinely useful.</h1>
            <p style={{ lineHeight: 1.7 }}>
              Every one of these is read. If you told us something went wrong, somebody will look at
              it, and you may hear back on the email or number you left.
            </p>
            <p style={{ marginTop: 18 }}>
              <Link className="btn" href="/dashboard">← Back to my dashboard</Link>
            </p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main>
      <section className="container" style={{ paddingTop: 36, paddingBottom: 70, maxWidth: 720 }}>
        <span className="badge">📝 Your feedback</span>
        <h1 style={{ margin: "12px 0 6px" }}>Tell us what you think</h1>
        <p className="muted" style={{ lineHeight: 1.7 }}>
          Ten questions, about two minutes. Answer only what you want to — anything left blank is
          simply skipped. Blunt is better than polite; we cannot fix what we are not told.
        </p>

        {sp.error === "name" && <div className="notice err" style={{ marginTop: 14 }}>Please tell us your name.</div>}
        {sp.error === "empty" && <div className="notice err" style={{ marginTop: 14 }}>Nothing was filled in — please answer at least one question.</div>}
        {sp.error === "save" && <div className="notice err" style={{ marginTop: 14 }}>Something went wrong saving that. Please try once more.</div>}

        <form action={submitFeedback} className="card" style={{ marginTop: 18 }}>
          <input type="hidden" name="source" value={sp.from ?? "footer"} />

          <h2 style={{ marginTop: 0, fontSize: "1.05rem" }}>Who you are</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
            <div>
              <label htmlFor="fname">Your name</label>
              <input id="fname" name="name" defaultValue={name} required />
            </div>
            <div>
              <label htmlFor="fmail">Email</label>
              <input id="fmail" name="email" type="email" defaultValue={email} />
            </div>
            <div>
              <label htmlFor="fphone">Phone</label>
              <input id="fphone" name="phone" defaultValue={phone} />
            </div>
          </div>
          <p className="muted" style={{ fontSize: ".8rem", marginTop: -2 }}>
            Email and phone only so we can come back to you if something needs fixing.
          </p>

          <h2 style={{ fontSize: "1.05rem", marginTop: 22 }}>How are we doing?</h2>
          <div style={{ display: "grid", gap: 16 }}>
            {FEEDBACK_RATINGS.map((q) => (
              <fieldset key={q.key} style={{ border: 0, padding: 0, margin: 0 }}>
                <legend style={{ fontWeight: 600, fontSize: ".92rem", padding: 0 }}>{q.label}</legend>
                {q.hint && <p className="muted" style={{ fontSize: ".78rem", margin: "2px 0 6px" }}>{q.hint}</p>}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                  {SCALE.map((s) => (
                    <label
                      key={s.value}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 6, marginBottom: 0,
                        border: "1px solid var(--border)", borderRadius: 999,
                        padding: "5px 11px", fontSize: ".82rem", cursor: "pointer",
                      }}
                    >
                      <input type="radio" name={q.key} value={s.value} />
                      {s.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>

          <h2 style={{ fontSize: "1.05rem", marginTop: 22 }}>In your own words</h2>
          {FEEDBACK_TEXT.map((q) => (
            <div key={q.key} style={{ marginBottom: 12 }}>
              <label htmlFor={q.key}>{q.label}</label>
              {q.hint && <p className="muted" style={{ fontSize: ".78rem", margin: "0 0 4px" }}>{q.hint}</p>}
              <textarea
                id={q.key}
                name={q.key}
                rows={3}
                style={{
                  width: "100%", background: "var(--bg-soft)", color: "var(--text)",
                  border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px",
                  fontFamily: "inherit",
                }}
              />
            </div>
          ))}

          <SubmitButton className="btn block">Send my feedback</SubmitButton>
          <p className="muted" style={{ fontSize: ".78rem", marginTop: 8, textAlign: "center" }}>
            Read by CA Parveen Sharma and the team. Never shown to other students.
          </p>
        </form>
      </section>
    </main>
  );
}
