import { formatDate } from "@/lib/dates";
import Link from "next/link";
import SubmitButton from "@/app/components/SubmitButton";
import { DURATIONS, durationLabel } from "@/lib/pricing";
import AdminHero from "../_components/AdminHero";
import EnrolForm from "./EnrolForm";
import SpreadsheetPicker from "./SpreadsheetPicker";
import { grantSubscription, bulkGrant, revokeSubscription, extendSubscription, blockSubscription, restoreSubscription, queuePastStudents } from "./actions";
import { createServiceClient } from "@/lib/supabase/service";

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return formatDate(s);
}

type SubRow = {
  id: string;
  ends_at: string | null;
  status: string;
  blocked_reason?: string | null;
  auto_renew: boolean;
  channel: string;
  profiles: { email: string | null; full_name: string | null } | null;
  courses: { title: string } | null;
  subjects: { title: string } | null;
  plans: { tier: string } | null;
};
type CourseRow = { id: string; title: string; subjects: { id: string; title: string }[] };

export default async function EnrolmentPage(
  props: {
    searchParams: Promise<{ granted?: string; missing?: string; error?: string; dupe?: string; until?: string; dupe_id?: string; dupe_name?: string; extended?: string; extended_to?: string; q?: string; tier?: string; months?: string; course?: string; blocked?: string; restored?: string; queued?: string; requeued?: string; badlines?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  // READ WITH THE SERVICE CLIENT, NOT HER OWN SESSION.
  //
  // subscriptions RLS is "your own row, or is_admin()", and is_admin() is true
  // only for role = 'admin'. An OPERATOR holding the Enrolment grant would
  // open this page and see an empty list — the same fault that made the Users
  // page show Hemlata nothing but herself. courses is worse still: unpublished
  // ones are admin-only, so a course she is meant to grant would be missing
  // from the picker entirely.
  //
  // Authorisation lives in the app layer, where the grant is: the admin layout
  // refuses anyone without it and all seven actions here assertArea("enrolment").
  const supabase = createServiceClient();

  // THE HUNDRED MOST RECENT IS NOT ENOUGH TO FIND ANYONE BY.
  //
  // The desk was told to "use Extend on the row below" for a student who had
  // enrolled eighteen months earlier and was nowhere near this list. Searching
  // by name or email finds the row wherever it sits.
  const query = (searchParams.q ?? "").trim();
  const SELECT =
    "id, ends_at, status, auto_renew, channel, blocked_reason, profiles(email, full_name), courses(title), subjects(title), plans(tier)";

  // Matched in two steps rather than by filtering the embedded profile: find
  // the people, then their subscriptions. Filtering an embedded table only
  // narrows what is embedded unless the join is inner, and getting that subtly
  // wrong here would silently show the desk an empty list for a student who
  // does exist — the exact failure this search is meant to end.
  let studentIds: string[] | null = null;
  if (query) {
    const like = `%${query.replace(/[%_,()]/g, "")}%`;
    const { data: people } = await supabase
      .from("profiles").select("id")
      .or(`email.ilike.${like},full_name.ilike.${like}`)
      .limit(200);
    studentIds = (people ?? []).map((p) => p.id as string);
  }

  const subsQuery = studentIds
    ? supabase.from("subscriptions").select(SELECT)
        .in("student_id", studentIds.length ? studentIds : ["00000000-0000-0000-0000-000000000000"])
        .order("ends_at", { ascending: false, nullsFirst: false }).limit(50)
    : supabase.from("subscriptions").select(SELECT)
        .order("created_at", { ascending: false }).limit(100);

  const [{ data: courses }, { data: subs }] = await Promise.all([
    supabase.from("courses").select("id, title, subjects(id, title)").order("order_index").order("title"),
    subsQuery,
  ]);

  // Drip-queue progress (service client — the queue table is server-only).
  const svcQ = createServiceClient();
  const [{ count: qPending }, { count: qSent }, { count: qSkipped }, { count: qFailed }] = await Promise.all([
    svcQ.from("grant_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
    svcQ.from("grant_queue").select("id", { count: "exact", head: true }).eq("status", "sent"),
    svcQ.from("grant_queue").select("id", { count: "exact", head: true }).eq("status", "skipped"),
    svcQ.from("grant_queue").select("id", { count: "exact", head: true }).eq("status", "failed"),
  ]);

  const courseList = (courses ?? []) as unknown as CourseRow[];
  const subscriptions = (subs ?? []) as unknown as SubRow[];
  // Bulk grants come back with a COUNT, a single grant with the student's
  // email — so the confirmation can name who got what instead of just ticking.
  const grantedRaw = searchParams.granted ?? "";
  const grantedCount = grantedRaw && /^\d+$/.test(grantedRaw) ? Number(grantedRaw) : null;
  const grantedEmail = grantedRaw && !/^\d+$/.test(grantedRaw) ? grantedRaw : null;
  const granted = grantedRaw ? 1 : null;
  const missing = searchParams.missing ? searchParams.missing.split(",") : [];

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="🎟️ Enrolment"
        title="Enrolment"
        subtitle="Grant access by course & subject (free). Online checkout arrives with payments (Phase 5). 🚀"
        back={{ href: "/admin", label: "Admin" }}
      />

      {grantedEmail && (
        <div className="notice ok" style={{ marginTop: 16, fontSize: ".95rem" }}>
          ✅ <strong>Done.</strong> {searchParams.course || "Access"}
          {searchParams.tier ? ` · ${searchParams.tier}` : ""}
          {searchParams.months ? ` · ${searchParams.months} month(s)` : ""} granted to <strong>{grantedEmail}</strong>,
          and they have been emailed. It appears in the list below.
        </div>
      )}
      {grantedCount !== null && (
        <div className="notice ok" style={{ marginTop: 16 }}>
          ✅ Granted {grantedCount} new subscription{grantedCount === 1 ? "" : "s"}.
          {searchParams.extended && (
            <> <strong>{searchParams.extended}</strong> already had access and were{" "}
            <strong>extended from their own expiry date</strong> rather than given a second subscription.</>
          )}
          {missing.length > 0 && <> Not found (no account yet): {missing.join(", ")}.</>}
        </div>
      )}
      {searchParams.dupe && (
        <div className="notice err" style={{ marginTop: 16, fontSize: ".95rem" }}>
          ⚠️ <strong>Subscription already added.</strong> {searchParams.dupe} already has an active subscription for
          that course and subject{searchParams.until ? <>, running until <strong>{searchParams.until}</strong></> : null}.
          Nothing was changed.
          {/* Telling the desk to "use Extend on the row below" was no help when
              the student was not among the hundred most recent. Extend it right
              here, on the row we just found. */}
          {searchParams.dupe_id ? (
            <form
              action={extendSubscription}
              style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}
            >
              <input type="hidden" name="id" value={searchParams.dupe_id} />
              <span>Extend it by</span>
              {/* A FREE NUMBER, NOT 1/3/6/12. His ask, 1 September: two months,
                  four, five — a part payment or a goodwill month is whatever it
                  is. The grant forms were given a free number on 20 August for
                  the same reason; the two Extend controls were missed. */}
              <input
                name="months"
                type="number"
                min={1}
                max={36}
                defaultValue={12}
                list="extend-month-presets"
                required
                style={{ marginBottom: 0, width: 90 }}
              />
              <span>months</span>
              <SubmitButton className="btn small">Extend now</SubmitButton>
              <span className="muted" style={{ fontSize: ".8rem" }}>
                — counted from {searchParams.until || "the current expiry"}, not from today
              </span>
            </form>
          ) : (
            <> To extend it, find the student below and use <strong>Extend</strong>.</>
          )}
        </div>
      )}
      {searchParams.extended_to && (
        <div className="notice ok" style={{ marginTop: 16 }}>
          ✅ Extended — access now runs until <strong>{searchParams.extended_to}</strong>.
        </div>
      )}
      {searchParams.blocked && (
        <div className="notice ok" style={{ marginTop: 16 }}>
          🚫 Subscription blocked — the student loses access immediately. Use <strong>Restore</strong> to undo.
        </div>
      )}
      {searchParams.missing && granted === null && (
        <div className="notice err" style={{ marginTop: 16 }}>
          No account found for {searchParams.missing}. The student must sign up first.
        </div>
      )}
      {searchParams.error === "missing" && (
        <div className="notice err" style={{ marginTop: 16 }}>
          Please fill in email, course, subject and tier.
        </div>
      )}
      
      {/* The wording itself lives with every other email, on one page. */}
      <p className="muted" style={{ fontSize: ".84rem", marginTop: 16 }}>
        ✉️ The email these students receive is written on the{" "}
        <Link href="/admin/emails#access_granted">Emails page</Link> — read it before a batch goes out.
      </p>

      {searchParams.error === "noplan" && (
        <div className="notice err" style={{ marginTop: 16 }}>
          No active plan found for that tier. Check the Plans page.
        </div>
      )}

      {searchParams.queued && (
        <div className="notice ok" style={{ marginTop: 16 }}>
          ✓ {searchParams.queued} student(s) queued. Emails drip out ~18 an hour (about 430 a day) — slow on purpose, so nobody's inbox sees a burst.
          {searchParams.requeued ? ` ${searchParams.requeued} were already queued or done for this course (not repeated).` : ""}
          {searchParams.badlines ? ` ⚠️ ${searchParams.badlines} line(s) had no email address and were ignored.` : ""}
        </div>
      )}
      {searchParams.error === "queueinput" && (
        <div className="notice err" style={{ marginTop: 16 }}>Pick a course, and upload the filled template or paste at least one line with an email address.</div>
      )}

      {/* Past students at any scale: paste once, the cron drips the emails. */}
      <div className="form-card" style={{ marginTop: 24 }}>
        <h3>🕰️ Past students — complimentary access (any size, sent slowly)</h3>
        <p className="muted" style={{ fontSize: ".84rem", margin: "6px 0 10px" }}>
          <a href="/admin/enrolment/template" download>⬇️ Download the Excel template</a> — fill it (Email, Name — name
          optional), upload it below, done. Or paste lines of <code>email, name</code> straight into the box.
          Accounts that don&apos;t exist are created; new people get a set-password button in
          the email, existing students just log in. The letter itself is the one on the{" "}
          <Link href="/admin/emails#access_granted">Emails page</Link> — sent as <strong>CA Parveen Sharma</strong>,
          marked important, and dripped at ~18 an hour (about 430 a day — a 1,500 list takes 3–4 days) so the batch never trips spam filters. Anyone already holding active
          access to the course is skipped without an email.
        </p>
        {(qPending ?? 0) + (qSent ?? 0) + (qSkipped ?? 0) + (qFailed ?? 0) > 0 && (
          <div className="card" style={{ marginBottom: 12, display: "flex", gap: 22, flexWrap: "wrap" }}>
            <div><div className="muted" style={{ fontSize: ".74rem" }}>Waiting to send</div><div style={{ fontSize: "1.3rem", fontWeight: 800 }}>{qPending ?? 0}</div></div>
            <div><div className="muted" style={{ fontSize: ".74rem" }}>Sent</div><div style={{ fontSize: "1.3rem", fontWeight: 800 }}>{qSent ?? 0}</div></div>
            <div><div className="muted" style={{ fontSize: ".74rem" }}>Skipped (already had access)</div><div style={{ fontSize: "1.3rem", fontWeight: 800 }}>{qSkipped ?? 0}</div></div>
            {(qFailed ?? 0) > 0 && <div><div className="muted" style={{ fontSize: ".74rem" }}>Failed</div><div style={{ fontSize: "1.3rem", fontWeight: 800, color: "var(--bad)" }}>{qFailed}</div></div>}
            {(qPending ?? 0) > 0 && (
              <div className="muted" style={{ fontSize: ".78rem", alignSelf: "center" }}>
                ⏳ roughly {(qPending ?? 0) > 400 ? `${Math.ceil((qPending ?? 0) / 432)} day(s)` : `${Math.ceil((qPending ?? 0) / 18)} hour(s)`} to finish — refresh to watch it move.
              </div>
            )}
          </div>
        )}
        <form action={queuePastStudents} style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
            <div>
              <label>Course *</label>
              <select name="course_id" required defaultValue="">
                <option value="" disabled>choose…</option>
                {courseList.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </div>
            <div>
              <label>Subject (empty = whole course)</label>
              <select name="subject_id" defaultValue="">
                <option value="">Whole course</option>
                {courseList.flatMap((c) => c.subjects.map((su) => (
                  <option key={su.id} value={su.id}>{c.title} — {su.title}</option>
                )))}
              </select>
            </div>
            <div>
              <label>Tier</label>
              <select name="tier" defaultValue="gold">
                <option value="gold">Gold</option><option value="silver">Silver</option><option value="bronze">Bronze</option>
              </select>
            </div>
            <div>
              <label>Months</label>
              <input name="months" type="number" min={1} max={36} defaultValue={3} />
            </div>
          </div>
          <SpreadsheetPicker />
          <div>
            <label>…or paste the list here — any number of students</label>
            <textarea name="bulk" rows={6} placeholder={"ravi@example.com, Ravi Kumar\npriya@example.com, Priya Singh\n… paste thousands if you like"} style={{ fontFamily: "monospace", fontSize: ".82rem" }} />
          </div>
          <SubmitButton className="btn" savedLabel="✓ Queued — sending has begun">Queue the whole list</SubmitButton>
        </form>
      </div>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr", marginTop: 24 }}>
        <div className="form-card">
          <h3>➕ Grant to one student</h3>
          <EnrolForm courses={courseList} action={grantSubscription} mode="single" />
        </div>
        <div className="form-card">
          <h3>👥 Bulk grant (CSV / list)</h3>
          <EnrolForm courses={courseList} action={bulkGrant} mode="bulk" />
        </div>
      </div>

      {/* Common terms as a hint on both Extend boxes; any whole number up to
          36 is accepted, and extendSubscription clamps to that range. */}
      <datalist id="extend-month-presets">
        {DURATIONS.map((m) => <option key={m} value={m}>{durationLabel(m)}</option>)}
      </datalist>
      <h2 className="admin-section-title">
        🎫 {query ? `Subscriptions matching “${query}”` : "Recent subscriptions"}
      </h2>
      <form method="get" style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <input
          name="q"
          defaultValue={query}
          placeholder="Find a student by name or email — then Extend their row"
          style={{ marginBottom: 0, flex: 1, minWidth: 260 }}
        />
        <SubmitButton className="btn small secondary">🔍 Find</SubmitButton>
        {query && <Link className="btn small secondary" href="/admin/enrolment">Clear</Link>}
      </form>
      {query && (
        <p className="muted" style={{ fontSize: ".8rem", marginTop: 6 }}>
          Showing every active and past subscription for anyone matching, longest-running first — not just the
          hundred most recent.
        </p>
      )}
      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
        {subscriptions.length > 0 ? (
          subscriptions.map((s) => (
            <div className="list-row" key={s.id}>
              <div>
                <span className="row-title">{s.profiles?.full_name || s.profiles?.email || "Unknown"}</span>
                <p className="row-sub">
                  {s.courses?.title ?? "—"} · {s.subjects?.title ?? "Whole course"} · {s.plans?.tier ?? "—"} ·{" "}
                  {s.status === "blocked" ? "🚫 blocked" : s.status}
                  {s.status === "active" ? ` · expires ${fmtDate(s.ends_at)}` : ""} · {s.channel}
                  {s.status === "blocked" && s.blocked_reason ? ` · ${s.blocked_reason}` : ""}
                </p>
              </div>
              <div className="row-actions">
                <form action={extendSubscription} style={{ display: "flex", gap: 6, alignItems: "center", margin: 0 }}>
                  <input type="hidden" name="id" value={s.id} />
                  <input
                    name="months"
                    type="number"
                    min={1}
                    max={36}
                    defaultValue={3}
                    list="extend-month-presets"
                    required
                    aria-label="Months to add"
                    style={{ marginBottom: 0, width: 74 }}
                  />
                  <span className="muted" style={{ fontSize: ".76rem" }}>months</span>
                  <SubmitButton className="btn small secondary">Extend</SubmitButton>
                  <span className="muted" style={{ fontSize: ".72rem" }} title="Months are added on top of the current expiry, never from today">
                    {s.status === "active" && s.ends_at && new Date(s.ends_at) > new Date()
                      ? `from ${fmtDate(s.ends_at)}`
                      : "from today"}
                  </span>
                </form>
                {s.status === "blocked" && (
                  <form action={restoreSubscription} style={{ display: "inline", margin: 0 }}>
                    <input type="hidden" name="id" value={s.id} />
                    <button className="btn small" type="submit">↩️ Restore</button>
                  </form>
                )}
                {s.status === "active" && (
                  <form action={blockSubscription} style={{ display: "inline-flex", gap: 4, margin: 0 }}>
                    <input type="hidden" name="id" value={s.id} />
                    <input name="reason" placeholder="reason (refund, misconduct…)" style={{ width: 170, fontSize: ".78rem" }} />
                    <button className="btn small secondary" type="submit" title="Blocks access immediately; reversible">🚫 Block</button>
                  </form>
                )}
                {s.status === "active" && (
                  <form action={revokeSubscription} style={{ display: "inline", margin: 0 }}>
                    <input type="hidden" name="id" value={s.id} />
                    <SubmitButton className="btn small secondary">
                      Revoke
                    </SubmitButton>
                  </form>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="card">
            <p className="muted">📭 No subscriptions yet.</p>
          </div>
        )}
      </div>
    </section>
  );
}
