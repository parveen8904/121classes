import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import { formatDate } from "@/lib/dates";
import { viaProxy } from "@/lib/fileProxy";
import { sendCvsToEmployer } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Student CV bank — Admin" };

// THE CV BANK. Students keep their placement profile at /career/profile; the
// office picks candidates here and sends them — resumes attached — straight to
// an employer. Only consented profiles are offered: an unticked box means the
// student's papers never leave, however useful they would be.
export default async function CvBankPage(props: {
  searchParams: Promise<{ sent?: string; err?: string; all?: string }>;
}) {
  const sp = await props.searchParams;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/cvs");
  const { data: me } = await supabase.from("profiles").select("role, permissions").eq("id", user.id).maybeSingle();
  const role = me?.role as string | undefined;
  const perms = ((me as { permissions?: string[] } | null)?.permissions ?? []);
  if (role !== "admin" && !(role === "faculty" || perms.includes("students"))) redirect("/dashboard");

  const svc = createServiceClient();
  const showAll = sp.all === "1";
  let q = svc.from("career_profiles").select("*").order("updated_at", { ascending: false }).limit(200);
  if (!showAll) q = q.eq("share_consent", true);
  const { data: rows } = await q;
  const people = rows ?? [];

  const td: React.CSSProperties = { padding: "8px 8px", borderBottom: "1px solid var(--border)", verticalAlign: "top", fontSize: ".86rem" };

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 1100 }}>
      <AdminHero
        badge="📇 Student CV bank"
        title="Profiles ready to send to employers"
        subtitle="Students keep their own profile and resume at /career/profile. Tick candidates below, give the employer's email, and their resumes go attached — only students who consented are offered here."
        back={{ href: "/admin", label: "Admin" }}
      />

      {sp.sent && <div className="notice ok" style={{ marginTop: 14 }}>✅ Sent {sp.sent} profile(s) with resumes attached.</div>}
      {sp.err && <div className="notice err" style={{ marginTop: 14 }}>❌ {sp.err}</div>}

      <form id="cv-send" action={sendCvsToEmployer} className="card" style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <label>Employer&apos;s email</label>
          <input name="to" type="email" required placeholder="hr@firm.com" style={{ marginBottom: 0 }} />
        </div>
        <div style={{ flex: 2, minWidth: 260 }}>
          <label>A line to the employer (optional)</label>
          <input name="note" placeholder="As discussed, sharing three CA Final candidates for the Ind AS role…" style={{ marginBottom: 0 }} />
        </div>
        <SubmitButton className="btn">📤 Send ticked profiles</SubmitButton>
      </form>

      <p className="muted" style={{ fontSize: ".82rem", margin: "10px 0" }}>
        {showAll
          ? <>Showing everyone, including students who have NOT consented — they cannot be ticked. <a href="/admin/cvs">Show consented only</a></>
          : <>{people.length} consented profile(s). <a href="/admin/cvs?all=1">Show everyone, including not-yet-consented</a></>}
      </p>

      <div className="card" style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <tbody>
            {people.length === 0 && (
              <tr><td style={td}><span className="muted">No profiles yet. Students fill theirs at caparveensharma.com/career/profile.</span></td></tr>
            )}
            {people.map((p) => (
              <tr key={p.student_id as string}>
                <td style={td}>
                  {p.share_consent
                    ? <input type="checkbox" name="student_ids" value={p.student_id as string} form="cv-send" />
                    : <span title="No consent — cannot be sent">🔒</span>}
                </td>
                <td style={td}>
                  <strong>{(p.full_name as string) || "—"}</strong>
                  <div className="muted" style={{ fontSize: ".78rem" }}>{p.email as string} · {p.phone as string}</div>
                </td>
                <td style={td}>{(p.qualification as string) || "—"}
                  <div className="muted" style={{ fontSize: ".78rem" }}>{p.city as string}{p.state ? `, ${p.state}` : ""}</div></td>
                <td style={td}>{(p.skills as string) || ""}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  {p.resume_url ? <a className="btn small secondary" href={viaProxy(p.resume_url as string)} target="_blank">📄 Resume</a> : <span className="muted">no resume</span>}{" "}
                  {p.photo_url ? <a className="btn small secondary" href={viaProxy(p.photo_url as string)} target="_blank">🖼️</a> : null}
                </td>
                <td style={{ ...td, whiteSpace: "nowrap" }} className="muted">{formatDate(p.updated_at as string)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
