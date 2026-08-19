import { formatDate, formatDateTime } from "@/lib/dates";
import { notFound } from "next/navigation";
import SubmitButton from "@/app/components/SubmitButton";
import { createClient } from "@/lib/supabase/server";
import AdminHero from "../../_components/AdminHero";
import DeleteButton from "../../_components/DeleteButton";
import { updateUser, sendSetPasswordEmail, adminSetPassword, resetStudyPlan, resetStudentTests, resetOneAttempt, regradeAttempt, makeLoginLink } from "../actions";
import { startViewAs } from "@/app/dashboard/viewAsActions";
import PaperForStudent from "./PaperForStudent";
import { ADMIN_AREAS } from "@/lib/adminAccess";

function fmt(s: string | null): string {
  if (!s) return "—";
  return formatDate(s);
}

type SubRow = {
  id: string;
  status: string;
  ends_at: string | null;
  channel: string;
  courses: { title: string } | null;
  subjects: { title: string } | null;
  plans: { tier: string } | null;
};

export default async function UserDetail(
  props: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ pwset?: string; pwerr?: string; testsreset?: string; loginlink?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const supabase = createClient();
  const { data: u } = await supabase
    .from("profiles")
    .select(
      "id, full_name, email, phone, role, permissions, target_attempt, created_at, address_line1, address_line2, city, state, pincode, gstin, business_name, designation, is_supporter",
    )
    .eq("id", params.id)
    .maybeSingle();
  if (!u) notFound();

  // Level (CA Final / CA Inter) — from the student's course shelf. Service
  // client: my_courses RLS is own-rows-only, so the admin's user client
  // reads nothing for other students.
  const { createServiceClient: svcClient } = await import("@/lib/supabase/service");
  const { data: myCourseRows } = await svcClient()
    .from("my_courses")
    .select("courses(title)")
    .eq("student_id", u.id);
  const levels = [...new Set((myCourseRows ?? [])
    .map((r) => ((r as { courses?: { title?: string } | null }).courses?.title ?? "").toLowerCase())
    .map((t) => (t.includes("final") ? "CA Final" : t.includes("inter") ? "CA Intermediate" : ""))
    .filter(Boolean))];
  const levelLabel = levels.join(" + ");

  const { data: subsData } = await supabase
    .from("subscriptions")
    .select("id, status, ends_at, channel, courses(title), subjects(title), plans(tier)")
    .eq("student_id", u.id)
    .order("created_at", { ascending: false });
  const subs = (subsData ?? []) as unknown as SubRow[];

  // Watch progress + activity log (what the student is doing — for planning).
  const { data: watch } = await supabase
    .from("class_watch")
    .select("video_seconds, real_seconds, duration_seconds, completed, last_watched_at, sections(title, topics(title))")
    .eq("student_id", u.id)
    .order("last_watched_at", { ascending: false })
    .limit(60);
  const { data: activity } = await supabase
    .from("student_activity")
    .select("kind, detail, created_at, sections(title)")
    .eq("student_id", u.id)
    .order("created_at", { ascending: false })
    .limit(40);
  const fmtSecs = (s: number) => {
    const m = Math.round((s || 0) / 60);
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  };
  const fmtWhen = (d: string) => formatDateTime(d);
  const ACT_LABEL: Record<string, string> = { class_open: "▶️ Opened a class", class_complete: "✅ Finished a class", test_submitted: "🧠 Gave a test", doubt: "💬 Asked a doubt", plan_built: "🗓️ Built a plan" };
  type WatchRow = { video_seconds: number; real_seconds: number; duration_seconds: number; completed: boolean; last_watched_at: string; sections: { title: string; topics: { title: string } | null } | null };
  type ActRow = { kind: string; detail: Record<string, unknown> | null; created_at: string; sections: { title: string } | null };
  // The papers a paper can be handed in against — same two lists the student's
  // own /check-my-paper page offers, and only tests with an approved key.
  const svc2 = svcClient();
  const { data: checkable } = await svc2.rpc("list_checkable_tests");
  const markableTests = ((checkable ?? []) as { id: string; title: string; subject: string }[])
    .map((t) => ({ id: t.id, title: t.title, subject: t.subject ?? "Tests" }));
  const { data: mockRows2 } = await svc2
    .from("mock_papers").select("id, title").eq("status", "approved").order("paper_no");
  const markableMocks = ((mockRows2 ?? []) as { id: string; title: string }[]);

  // Every test this student has sat, for the per-test reset and the AI
  // re-evaluation — the office asked to stop using the everything-at-once reset.
  const { data: descAttempts } = await svc2
    .from("descriptive_attempts")
    .select("id, section_id, mock_paper_id, submitted_at, status, review_status, awarded_marks, total_marks, sections:section_id(title), mock_papers:mock_paper_id(title)")
    .eq("student_id", u.id)
    .order("submitted_at", { ascending: false })
    .limit(40);
  const { data: mcqAttempts } = await svc2
    .from("mcq_attempts")
    .select("id, section_id, score, total, created_at, sections:section_id(title)")
    .eq("student_id", u.id)
    .order("created_at", { ascending: false })
    .limit(40);

  const watchRows = (watch ?? []) as unknown as WatchRow[];
  const actRows = (activity ?? []) as unknown as ActRow[];

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 820 }}>
      <AdminHero
        badge="👤 User"
        title={u.full_name || u.email || "User"}
        subtitle={`${u.email ?? u.phone ?? ""}${levelLabel ? ` · 📘 ${levelLabel}` : ""}${u.target_attempt ? ` · 🎯 ${u.target_attempt}` : ""} · joined ${fmt(u.created_at)} · role: ${u.role}`}
        back={{ href: "/admin/users", label: "Users" }}
      />

      {/* SEE WHAT THEY SEE — WITHOUT ASKING FOR THEIR PASSWORD.
          "It's showing error" is nearly impossible to act on from a table of
          rows; the same fault is usually obvious on the student's own screen.
          Read-only, and every look is recorded in admin_view_as_log. */}
      <form action={startViewAs} style={{ marginTop: 16 }}>
        <input type="hidden" name="student_id" value={params.id} />
        <SubmitButton className="btn">👁️ Open this student&apos;s dashboard</SubmitButton>
        <p className="muted" style={{ fontSize: ".82rem", margin: "6px 0 0" }}>
          Exactly what they see when they sign in — read only, and no password needed. Nothing on that
          screen can change their account. The look is recorded, and it ends by itself after an hour.
        </p>
      </form>

      {searchParams.loginlink && (
        <div className="notice" style={{ marginTop: 14, fontSize: ".88rem", lineHeight: 1.75 }}>
          <strong>🔑 One-time sign-in link made.</strong> Open it in an <strong>incognito / private window</strong> —
          in this window it would sign <em>you</em> out and put you inside their account here.
          It works once and expires shortly.
          <div style={{ marginTop: 8, wordBreak: "break-all", fontFamily: "monospace", fontSize: ".78rem", background: "var(--bg-soft)", padding: "8px 10px", borderRadius: 8 }}>
            {searchParams.loginlink}
          </div>
        </div>
      )}

      <form action={makeLoginLink} style={{ marginTop: 10 }}>
        <input type="hidden" name="id" value={params.id} />
        <SubmitButton className="btn small secondary">🔑 Sign in as this user (one-time link)</SubmitButton>
        <p className="muted" style={{ fontSize: ".8rem", margin: "6px 0 0" }}>
          For faults the read-only view cannot reproduce — uploads, quotas, vendor screens — because those run under
          the user&apos;s own session. Open the link in an incognito window. Every use is recorded.
        </p>
      </form>

      {/* HAND IN A PAPER FOR THEM.
          Manvi Maroti tried for two days from a phone on a slow line and her
          paper still is not marked. Every fix for that runs on her handset; this
          does not. She sends the file however she can and it goes in from here,
          against the same key, to the same examiner. */}
      <details style={{ marginTop: 14 }}>
        <summary className="btn small secondary as-btn">📤 Upload a paper for this student</summary>
        <div className="form-card" style={{ marginTop: 10 }}>
          <p className="muted" style={{ fontSize: ".85rem", margin: 0, lineHeight: 1.7 }}>
            For a student who cannot send it themselves — a slow connection, a phone that will not scan. They email or
            WhatsApp you the file and it goes in from here, on a real connection. It becomes the <strong>same
            attempt</strong> a student creates: same answer key, same step marking, same examiner, same annotated copy
            back. Who uploaded it is recorded on their activity log.
          </p>
          <PaperForStudent
            studentId={params.id}
            studentName={u.full_name || u.email || "this student"}
            tests={markableTests}
            mocks={markableMocks}
          />
        </div>
      </details>

      {searchParams.pwset && (
        <div className="notice ok" style={{ marginTop: 16 }}>
          ✅ Password set. Give the student exactly this: <code style={{ fontWeight: 700 }}>{searchParams.pwset}</code>
          {" — "}they can change it later from their dashboard.
        </div>
      )}
      {searchParams.testsreset && (
        <div className="notice ok" style={{ marginTop: 16 }}>
          ✅ Cleared: {searchParams.testsreset}. They can sit those tests again.
        </div>
      )}
      {searchParams.pwerr && (
        <div className="notice err" style={{ marginTop: 16 }}>
          ❌ The password was <strong>not</strong> changed. {searchParams.pwerr}
        </div>
      )}

      {/* Password rescue tools */}
      <details style={{ marginTop: 18 }}>
        <summary className="btn small secondary as-btn">🔑 Password help</summary>
        <div className="form-card" style={{ marginTop: 10 }}>
          <h3 style={{ marginTop: 0 }}>Reset this user&apos;s password</h3>
          {u.email ? (
            <>
              <form action={sendSetPasswordEmail} style={{ marginBottom: 14 }}>
                <input type="hidden" name="email" value={u.email} />
                <input type="hidden" name="name" value={u.full_name ?? ""} />
                <p className="muted" style={{ fontSize: ".85rem", marginBottom: 8 }}>
                  Email them a link to set their own password (recommended).
                </p>
                <SubmitButton className="btn small">📧 Send set-password email</SubmitButton>
              </form>
              <form action={adminSetPassword}>
                <input type="hidden" name="id" value={u.id} />
                <p className="muted" style={{ fontSize: ".85rem", marginBottom: 8 }}>
                  Or set a password directly and tell them what it is. It must have{" "}
                  <strong>8+ characters, a CAPITAL, a small letter, a number and a symbol</strong> — the account
                  refuses anything less, which is why a simple one silently did nothing before.
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input name="password" type="text" placeholder="e.g. Ca@2026Pass" style={{ marginBottom: 0, maxWidth: 240 }} />
                  <SubmitButton className="btn small secondary">Set password</SubmitButton>
                </div>
              </form>
            </>
          ) : (
            <p className="muted">This user has no email on file.</p>
          )}
        </div>
      </details>

      {/* Fresh start: wipes the plan + its progress ticks, like a new student.
          Kept ALWAYS VISIBLE — the founder couldn't find it when collapsed. */}
      <div className="card" style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <strong>🗓️ Study plan</strong>
          <p className="muted" style={{ fontSize: ".82rem", margin: "2px 0 0" }}>
            Reset deletes their plan, remarks and class-done ticks — the planner starts fresh, like a brand-new student.
          </p>
        </div>
        <DeleteButton
          action={resetStudyPlan}
          id={u.id}
          label="🔄 Reset study plan"
          message="Reset this student's study plan? Their plan, remarks and done-ticks will be wiped so they start fresh. This cannot be undone."
        />
      </div>

      {/* Let a student sit a test again.
          An attempt is one per student per test, so a wrong upload, a mis-click
          or a failed submission used to end that test for them permanently —
          the only reset button was on the founder's own preview of a paper. */}
      <div className="card" style={{ marginTop: 14 }}>
        <strong>📝 Test attempts</strong>
        <p className="muted" style={{ fontSize: ".82rem", margin: "2px 0 10px" }}>
          Clears this student&apos;s attempts so they can sit those tests again from the start. Their uploaded answer
          books and checked copies stay in storage — only the attempt is removed. Everyone else is untouched.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[
            ["descriptive", "✍️ Reset descriptive tests"],
            ["mcq", "🧠 Reset MCQ tests"],
            ["case", "📚 Reset case studies"],
            ["all", "🔄 Reset every test"],
          ].map(([what, label]) => (
            <form action={resetStudentTests} key={what}>
              <input type="hidden" name="id" value={u.id} />
              <input type="hidden" name="what" value={what} />
              <SubmitButton className={`btn small ${what === "all" ? "danger" : "secondary"}`} savedLabel="Reset">
                {label}
              </SubmitButton>
            </form>
          ))}
        </div>
      </div>

      <form action={updateUser} style={{ marginTop: 16 }}>
        <input type="hidden" name="id" value={u.id} />

        <div className="form-card">
          <h3>✏️ Profile</h3>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <label>Full name</label>
              <input name="full_name" defaultValue={u.full_name ?? ""} />
            </div>
            <div>
              <label>Phone</label>
              <input name="phone" defaultValue={u.phone ?? ""} />
            </div>
          </div>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
            <div>
              {/* What they are here — shown beside their name wherever they
                  acted on something, so "approved by Ritu" reads as a job
                  rather than as a name the reader has to place. A supporter's
                  designation is the same field, asked on their own profile. */}
              <label>Designation</label>
              <input name="designation" defaultValue={u.designation ?? ""} placeholder="e.g. Office Manager" />
            </div>
            <div>
              <label>Target attempt</label>
              <input name="target_attempt" defaultValue={u.target_attempt ?? ""} placeholder="e.g. MAY_2026" />
            </div>
            <div>
              <label>Role</label>
              <select name="role" defaultValue={u.role}>
                <option value="student">🎓 Student</option>
                <option value="supporter">💚 Supporter (sponsors students; not a student)</option>
                <option value="operator">🧑‍💼 Operator (staff)</option>
                <option value="faculty">👩‍🏫 Faculty</option>
                <option value="admin">🛠️ Admin (full access)</option>
              </select>
            </div>
          </div>
          <p className="muted" style={{ fontSize: ".8rem" }}>Email is the login identity and can&apos;t be changed here.</p>

          {/* Not a role — a sponsor is often a student, or a parent, or an old
              colleague. It sits beside whatever they already are. */}
          <div style={{ marginTop: 10, border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px" }}>
            <label className="remember" style={{ margin: 0 }}>
              <input type="checkbox" name="is_supporter" defaultChecked={Boolean(u.is_supporter)} />{" "}
              <strong>💚 Supporter</strong> — pays for other students
            </label>
            <p className="muted" style={{ fontSize: ".8rem", margin: "6px 0 0" }}>
              Opens their own page at <code>/supporter</code>: every student they have sponsored, what it cost, all
              their invoices, and a place to name the students they would like to sponsor next.
            </p>
          </div>

          <div style={{ marginTop: 14, border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px" }}>
            <strong>🔑 Rights (for Operator / Faculty)</strong>
            <p className="muted" style={{ fontSize: ".8rem", margin: "4px 0 10px" }}>
              Tick the admin areas this person may manage. Admins always have everything; students have none.
              Untick everything to remove their admin access.
            </p>
            <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))" }}>
              {ADMIN_AREAS.map((a) => (
                <label key={a.key} className="remember" style={{ margin: 0 }}>
                  <input type="checkbox" name="perm" value={a.key} defaultChecked={((u.permissions as string[]) ?? []).includes(a.key)} /> {a.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="form-card" style={{ marginTop: 16 }}>
          <h3>📦 Shipping address</h3>
          <label>Address line 1</label>
          <input name="address_line1" defaultValue={u.address_line1 ?? ""} />
          <label>Address line 2</label>
          <input name="address_line2" defaultValue={u.address_line2 ?? ""} />
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr 1fr" }}>
            <div>
              <label>City</label>
              <input name="city" defaultValue={u.city ?? ""} />
            </div>
            <div>
              <label>State</label>
              <input name="state" defaultValue={u.state ?? ""} />
            </div>
            <div>
              <label>PIN</label>
              <input name="pincode" defaultValue={u.pincode ?? ""} />
            </div>
          </div>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
            <div>
              <label>GSTIN</label>
              <input name="gstin" defaultValue={u.gstin ?? ""} />
            </div>
            <div>
              <label>Business name</label>
              <input name="business_name" defaultValue={u.business_name ?? ""} />
            </div>
          </div>
        </div>

        <SubmitButton className="btn" style={{ marginTop: 18 }}>
          Save user
        </SubmitButton>
      </form>

      {/* ONE TEST AT A TIME. Reset removes only the chosen attempt, so the rest
          of the record stands; re-evaluate clears one paper's marking and runs
          the AI again against the current key. The old buttons above still do
          the sweep when a whole record genuinely needs clearing. */}
      <h2 className="admin-section-title">🧪 Tests — reset or re-evaluate one</h2>
      <div className="card" style={{ overflowX: "auto" }}>
        {((descAttempts ?? []).length + (mcqAttempts ?? []).length) === 0 ? (
          <p className="muted" style={{ margin: 0 }}>No tests sat yet.</p>
        ) : (
          <table style={{ borderCollapse: "collapse", width: "100%", fontSize: ".86rem" }}>
            <tbody>
              {(descAttempts ?? []).map((a) => {
                const ttl = ((a as { mock_papers?: { title?: string } | null }).mock_papers?.title)
                  ?? ((a as { sections?: { title?: string } | null }).sections?.title) ?? "Descriptive test";
                return (
                  <tr key={a.id as string} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "8px 6px" }}>✍️ {ttl}</td>
                    <td style={{ padding: "8px 6px", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                      {a.awarded_marks != null ? `${a.awarded_marks}/${a.total_marks ?? "—"}` : (a.status as string)}
                      {a.review_status === "checked" ? " · released" : ""}
                    </td>
                    <td style={{ padding: "8px 6px", whiteSpace: "nowrap" }}>
                      <form action={regradeAttempt} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={u.id} />
                        <input type="hidden" name="attempt_id" value={a.id as string} />
                        <SubmitButton className="btn small secondary">🤖 Re-evaluate with AI</SubmitButton>
                      </form>{" "}
                      <form action={resetOneAttempt} style={{ display: "inline" }}>
                        <input type="hidden" name="id" value={u.id} />
                        <input type="hidden" name="kind" value="descriptive" />
                        <input type="hidden" name="attempt_id" value={a.id as string} />
                        <SubmitButton className="btn small secondary">↺ Reset this test</SubmitButton>
                      </form>
                    </td>
                  </tr>
                );
              })}
              {(mcqAttempts ?? []).map((a) => (
                <tr key={a.id as string} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "8px 6px" }}>✅ {((a as { sections?: { title?: string } | null }).sections?.title) ?? "MCQ test"}</td>
                  <td style={{ padding: "8px 6px", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{a.score as number}/{a.total as number}</td>
                  <td style={{ padding: "8px 6px", whiteSpace: "nowrap" }}>
                    <form action={resetOneAttempt} style={{ display: "inline" }}>
                      <input type="hidden" name="id" value={u.id} />
                      <input type="hidden" name="kind" value="mcq" />
                      <input type="hidden" name="attempt_id" value={a.id as string} />
                      <SubmitButton className="btn small secondary">↺ Reset this test</SubmitButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2 className="admin-section-title">📺 Watch progress ({watchRows.length})</h2>
      <p className="muted" style={{ fontSize: ".85rem" }}>Per class: how far through the video vs the real time spent. A real time much bigger than the video length means breaks / gaps.</p>
      <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
        {watchRows.length > 0 ? watchRows.map((w, i) => {
          const pct = w.duration_seconds > 0 ? Math.min(100, Math.round((w.video_seconds / w.duration_seconds) * 100)) : 0;
          const gap = w.real_seconds - w.video_seconds;
          return (
            <div className="card" key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <strong>{w.completed ? "✅ " : ""}{w.sections?.title ?? "Class"}</strong>
                <span className="muted" style={{ fontSize: ".78rem" }}>{w.sections?.topics?.title ? ` · ${w.sections.topics.title}` : ""} · last {fmtWhen(w.last_watched_at)}</span>
              </div>
              <span className="muted" style={{ fontSize: ".82rem", whiteSpace: "nowrap" }}>
                ▶️ {pct}% ({fmtSecs(w.video_seconds)}/{fmtSecs(w.duration_seconds)}) · ⏱️ spent {fmtSecs(w.real_seconds)}{gap > 120 ? ` · 🐢 +${fmtSecs(gap)} gaps` : ""}
              </span>
            </div>
          );
        }) : <p className="muted">No classes watched yet.</p>}
      </div>

      <h2 className="admin-section-title">🧾 Activity log ({actRows.length})</h2>
      <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
        {actRows.length > 0 ? actRows.map((a, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", fontSize: ".85rem", padding: "4px 0", borderBottom: "1px solid var(--border)" }}>
            <span>{ACT_LABEL[a.kind] ?? a.kind}{a.sections?.title ? ` — ${a.sections.title}` : ""}{a.detail && typeof a.detail.score !== "undefined" ? ` (${a.detail.score}/${a.detail.total})` : ""}</span>
            <span className="muted">{fmtWhen(a.created_at)}</span>
          </div>
        )) : <p className="muted">No activity yet.</p>}
      </div>

      <h2 className="admin-section-title">🎟️ Subscriptions</h2>
      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        {subs.length > 0 ? (
          subs.map((s) => (
            <div className="list-row" key={s.id}>
              <div>
                <span className="row-title">📘 {s.courses?.title ?? "Course"}</span>
                <p className="row-sub">
                  {s.subjects?.title ?? "Whole course"} · {s.plans?.tier ?? "—"} · {s.status}
                  {s.status === "active" ? ` · expires ${fmt(s.ends_at)}` : ""} · {s.channel}
                </p>
              </div>
            </div>
          ))
        ) : (
          <div className="card">
            <p className="muted">No subscriptions. Grant access from the Enrolment page.</p>
          </div>
        )}
      </div>
    </section>
  );
}
