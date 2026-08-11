import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import SubmitButton from "@/app/components/SubmitButton";
import { formatDate } from "@/lib/dates";
import { outcomesFor, outcomeLabel, type PushedLead } from "@/lib/supporterLeads";
import { pushOneLead, pushLeadFile } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Leads you have passed on" };

// THE NAMES A VENDOR GAVE US, AND WHAT CAME OF THEM.
//
// A vendor knows students we never will, and is willing to pass the names on —
// but only if they can see afterwards what happened. In particular they want to
// know when a student they introduced ended up buying somewhere else, because
// that is the case worth arguing about, and it can only be settled if the
// introduction was recorded before anybody knew the answer.
//
// So the outcome is worked out by matching, never typed in, and the vendor can
// add to this list but cannot edit what it says happened.

export default async function SupporterLeadsPage(props: {
  searchParams: Promise<{ ok?: string }>;
}) {
  await props.searchParams;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/supporter/leads");

  const svc = createServiceClient();
  const { data: me } = await svc
    .from("profiles").select("is_supporter, role").eq("id", user.id).maybeSingle();
  if (!me?.is_supporter && me?.role !== "admin" && me?.role !== "supporter") redirect("/dashboard");

  const [{ data: rows }, { data: subjects }] = await Promise.all([
    svc.from("supporter_pushed_leads")
      .select("id, name, phone, email, level, subject_id, address, note, lead_date, created_at, matched_user_id, converted_at, sold_by")
      .eq("supporter_id", user.id)
      .order("created_at", { ascending: false }).limit(1000),
    svc.from("subjects").select("id, title, courses(title)").limit(50),
  ]);

  const leads = (rows ?? []) as unknown as PushedLead[];
  const outcomes = await outcomesFor(leads, user.id);

  const enrolled = leads.filter((l) => outcomes.get(l.id)?.enrolled);
  const throughYou = enrolled.filter((l) => outcomes.get(l.id)?.through === "you");
  const elsewhere = enrolled.filter((l) => outcomes.get(l.id)?.through !== "you");

  const td: React.CSSProperties = { padding: "8px 10px", verticalAlign: "top", fontSize: ".86rem" };
  const th: React.CSSProperties = { padding: "8px 10px", textAlign: "left", color: "var(--muted)", fontWeight: 700, whiteSpace: "nowrap" };

  return (
    <main>
      <section className="container" style={{ paddingTop: 32, paddingBottom: 60, maxWidth: 1000 }}>
        <p style={{ marginBottom: 6 }}><Link className="muted" href="/supporter">← My desk</Link></p>
        <span className="badge">📇 Leads</span>
        <h1 style={{ margin: "12px 0 6px" }}>Students you have passed on</h1>
        <p className="muted" style={{ lineHeight: 1.7, maxWidth: 720 }}>
          Give us a name and we will follow it up. This page then shows you what happened to it — whether they
          opened an account, whether they enrolled, and if they did, whether it came through you.
        </p>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
          <div className="card" style={{ padding: "10px 16px" }}><strong>{leads.length}</strong> <span className="muted">passed on</span></div>
          <div className="card" style={{ padding: "10px 16px" }}><strong>{throughYou.length}</strong> <span className="muted">enrolled through you</span></div>
          <div className="card" style={{ padding: "10px 16px" }}><strong>{elsewhere.length}</strong> <span className="muted">enrolled another way</span></div>
        </div>

        {/* ── One at a time ────────────────────────────────────────────── */}
        <details className="card" style={{ marginTop: 18 }} open={leads.length === 0}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>✍️ Pass on one student</summary>
          <form action={pushOneLead} style={{ marginTop: 12 }}>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
              <div>
                <label htmlFor="ln">Student&apos;s name<span style={{ color: "#b91c1c" }}> *</span></label>
                <input id="ln" name="name" required />
              </div>
              <div><label htmlFor="lp">Phone</label><input id="lp" name="phone" inputMode="numeric" placeholder="10 digits" /></div>
              <div><label htmlFor="le">Email</label><input id="le" name="email" type="email" /></div>
              <div>
                <label htmlFor="ll">Level</label>
                <select id="ll" name="level">
                  <option value="">—</option>
                  <option>CA Final</option>
                  <option>CA Intermediate</option>
                </select>
              </div>
              <div>
                <label htmlFor="ls">Subject</label>
                <select id="ls" name="subject_id">
                  <option value="">—</option>
                  {(subjects ?? []).map((s) => (
                    <option key={String(s.id)} value={String(s.id)}>{String(s.title)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="ld">Date you spoke to them</label>
                <input id="ld" name="lead_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
              </div>
            </div>
            {/* Not required. A name taken across a counter rarely comes with an
                address, and refusing the lead over it loses the lead. */}
            <label htmlFor="la">Address <span className="muted" style={{ fontWeight: 400 }}>— optional</span></label>
            <input id="la" name="address" placeholder="Only if you have it" />
            <label htmlFor="lnote">Anything we should know <span className="muted" style={{ fontWeight: 400 }}>— optional</span></label>
            <input id="lnote" name="note" placeholder="e.g. sitting September, wants FR only" />
            <p className="muted" style={{ fontSize: ".8rem", lineHeight: 1.6 }}>
              A name and one way to reach them — a phone number or an email — is all that is required.
            </p>
            <SubmitButton className="btn" savedLabel="✓ Passed on">Pass this student on</SubmitButton>
          </form>
        </details>

        {/* ── A whole file ─────────────────────────────────────────────── */}
        <details className="card" style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>📄 Paste a whole list</summary>
          <form action={pushLeadFile} style={{ marginTop: 12 }}>
            <p className="muted" style={{ fontSize: ".84rem", lineHeight: 1.7 }}>
              Paste straight from your spreadsheet, with the heading row included. The columns can be in any order —
              we read them by their headings. Recognised: <strong>name</strong>, <strong>phone</strong>,{" "}
              <strong>email</strong>, <strong>level</strong>, <strong>address</strong>, <strong>date</strong>,{" "}
              <strong>note</strong>. Rows without a name, or without either a phone or an email, are skipped; so is
              anybody you have already passed on.
            </p>
            <textarea name="rows" rows={8} placeholder={"name,phone,email,level\nRahul Verma,9810012345,rahul@example.com,CA Final"} />
            <SubmitButton className="btn" savedLabel="✓ Added">Add the whole list</SubmitButton>
          </form>
        </details>

        {/* ── What became of them ──────────────────────────────────────── */}
        <h2 className="admin-section-title" style={{ marginTop: 28 }}>What happened to them</h2>
        {leads.length === 0 ? (
          <div className="card"><p className="muted" style={{ margin: 0 }}>
            Nothing passed on yet. Add a student above and this table will tell you what came of it.
          </p></div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={th}>Student</th><th style={th}>Contact</th><th style={th}>Level</th>
                <th style={th}>You told us</th><th style={th}>Where it stands</th>
              </tr></thead>
              <tbody>
                {leads.map((l) => {
                  const o = outcomes.get(l.id);
                  const lab = outcomeLabel(o);
                  return (
                    <tr key={l.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={td}>
                        <strong>{l.name}</strong>
                        {l.address ? <><br /><span className="muted" style={{ fontSize: ".78rem" }}>{l.address}</span></> : null}
                        {l.note ? <><br /><span className="muted" style={{ fontSize: ".78rem", fontStyle: "italic" }}>{l.note}</span></> : null}
                      </td>
                      <td style={td}>
                        {l.phone || <span className="muted">no phone</span>}
                        <br /><span className="muted" style={{ fontSize: ".78rem" }}>{l.email || "no email"}</span>
                      </td>
                      <td style={td}>{l.level || "—"}</td>
                      <td style={td}>{l.lead_date ? formatDate(`${l.lead_date}T06:00:00Z`) : formatDate(l.created_at)}</td>
                      <td style={{
                        ...td, fontWeight: lab.tone === "good" ? 700 : 400,
                        color: lab.tone === "good" ? "#16a34a" : lab.tone === "warn" ? "#b45309" : undefined,
                      }}>
                        {lab.text}
                        {o?.when ? <><br /><span className="muted" style={{ fontSize: ".78rem", fontWeight: 400 }}>{formatDate(o.when)}</span></> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="muted" style={{ fontSize: ".82rem", lineHeight: 1.7, marginTop: 14 }}>
          A student is matched to your lead by phone number or email address — never by name, because two students
          share a name far more often than a mobile number. If somebody you introduced shows as having enrolled
          another way and you believe it was your sale, say so: this page is the record of when you told us, and it
          was written before anyone knew the answer.
        </p>
      </section>
    </main>
  );
}
