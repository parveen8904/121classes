import { formatDateTime } from "@/lib/dates";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { requireArea } from "@/lib/adminAccess";
import SubmitButton from "@/app/components/SubmitButton";
import { holdSupporter, releaseSupporter, decideComplaint, recheckSupporterSite, clearSupporterSiteByHand } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Supporter compliance — Admin" };

// THE DESK WHERE A SELLER'S ACCOUNT IS ACTUALLY STOPPED.
//
// Three things arrive here and all three are only ever half-answers:
//   • a complaint one seller made about another;
//   • what the nightly read of their websites found;
//   • the accounts already on hold, waiting for the penalty.
//
// None of it decides anything. The machine reads a shop page and it will misread
// one eventually — a "50% off" that belongs to somebody else's product, a combo
// page that is three years dead. So every finding is shown with the words that
// caused it and the address they were on, and a person presses the button.
//
// Holding and upholding are deliberately two separate buttons. Deciding that a
// complaint is true, and deciding to stop somebody trading, are different
// judgements, and one should not quietly perform the other.

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const when = (v: unknown) =>
  v ? formatDateTime(String(v)) : "—";

/** theirsite.com from any address they typed, for matching a URL to an account. */
function host(u: string): string {
  try { return new URL(u.startsWith("http") ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase(); }
  catch { return ""; }
}

const TH: React.CSSProperties = { textAlign: "left", padding: "6px 10px", borderBottom: "1px solid var(--border)", fontWeight: 700 };
const TD: React.CSSProperties = { padding: "6px 10px", borderBottom: "1px solid var(--border)", verticalAlign: "top" };

const PROBLEM_LABEL: Record<string, string> = {
  discount: "More than 5% off",
  combo: "Bundled with another faculty",
  ownership: "Verification code not on the site",
  unreachable: "Site did not answer",
};

export default async function AdminSupporters(props: {
  searchParams: Promise<{ held?: string; released?: string; complaint?: string; checked?: string; err?: string }>;
}) {
  if (!(await requireArea("store"))) redirect("/admin");
  const sp = await props.searchParams;
  const svc = createServiceClient();

  const [{ data: complaintRows }, { data: sellerRows }, { data: checkRows }] = await Promise.all([
    svc.from("supporter_complaints")
      .select("id, ref, raised_by, against_url, against_id, what_happened, evidence_url, status, reviewed_at, outcome_note, created_at")
      .order("created_at", { ascending: false }).limit(200),
    svc.from("profiles")
      .select("id, full_name, business_name, designation, email, phone, supporter_site, supporter_site_ok_at, supporter_site_proof, supporter_blocked_at, supporter_block_reason, supporter_hold_auto, supporter_hold_evidence")
      .eq("is_supporter", true).limit(1000),
    svc.from("supporter_site_checks")
      .select("id, supporter_id, url, checked_at, ok, problem, detail, evidence")
      .order("checked_at", { ascending: false }).limit(400),
  ]);

  const complaints = (complaintRows ?? []) as Row[];
  const sellers = (sellerRows ?? []) as Row[];
  const checks = (checkRows ?? []) as Row[];

  const byId = new Map(sellers.map((x) => [s(x.id), x]));
  const byHost = new Map(sellers.filter((x) => x.supporter_site).map((x) => [host(s(x.supporter_site)), x]));
  const name = (x?: Row) => (x ? s(x.business_name) || s(x.full_name) || s(x.email) || "Unnamed supporter" : "");
  // A hold is put on a business but read by a person; the designation says who
  // will be reading it.
  const who = (x?: Row) => (x ? `${name(x)}${x.designation ? ` — ${s(x.designation)}` : ""}` : "");

  const open = complaints.filter((c) => s(c.status) === "open");
  const settled = complaints.filter((c) => s(c.status) !== "open").slice(0, 25);
  const held = sellers.filter((x) => x.supporter_blocked_at);

  // The latest read of each site, and only the ones that found something. An
  // old finding that a later clean read replaced is not news.
  const latest = new Map<string, Row>();
  for (const c of checks) if (!latest.has(s(c.supporter_id))) latest.set(s(c.supporter_id), c);
  const flagged = [...latest.values()].filter((c) => c.ok === false && s(c.problem) !== "unreachable");
  const unreachable = [...latest.values()].filter((c) => s(c.problem) === "unreachable");

  /** Who a complaint is about, if we can tell. */
  const accused = (c: Row): Row | undefined =>
    (c.against_id ? byId.get(s(c.against_id)) : undefined) ?? byHost.get(host(s(c.against_url)));

  return (
    <main>
      <section className="container" style={{ paddingTop: 28, paddingBottom: 70, maxWidth: 980 }}>
        <p className="crumb"><Link href="/admin">← Admin</Link></p>
        <span className="badge">🚩 Supporter compliance</span>
        <h1 style={{ margin: "12px 0 6px" }}>Complaints, site checks and holds</h1>
        <p className="muted" style={{ lineHeight: 1.7, maxWidth: 720 }}>
          Nothing on this page has happened to anyone yet. Read what was found, open the page
          yourself, and decide. A seller put on hold is emailed the reason the moment you press it —
          they can still sign in and serve the students they have already sold to, but no new order
          can be placed until the ₹5,000 penalty is settled.
        </p>

        {sp.held === "1" && <div className="notice ok" style={{ marginTop: 14 }}>Account put on hold. They have been emailed the reason.</div>}
        {sp.released === "1" && <div className="notice ok" style={{ marginTop: 14 }}>Hold lifted. They have been told they can order again.</div>}
        {sp.complaint && <div className="notice ok" style={{ marginTop: 14 }}>Complaint marked {sp.complaint}.</div>}
        {sp.checked && (
          <div className={`notice ${sp.checked === "clean" ? "ok" : "err"}`} style={{ marginTop: 14 }}>
            {sp.checked === "clean"
              ? "Read their site just now — nothing against the rules found."
              : `Read their site just now — ${PROBLEM_LABEL[sp.checked] ?? sp.checked}. It is listed below.`}
          </div>
        )}
        {sp.err && <div className="notice err" style={{ marginTop: 14 }}>⚠️ {sp.err}</div>}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "18px 0 6px" }}>
          <span className="badge">{open.length} complaint{open.length === 1 ? "" : "s"} waiting</span>
          <span className="badge">{flagged.length} site{flagged.length === 1 ? "" : "s"} flagged</span>
          <span className="badge">{held.length} on hold</span>
          <span className="badge">{sellers.length} supporters</span>
        </div>

        {/* ── Complaints waiting ─────────────────────────────────────────── */}
        <h2 style={{ fontSize: "1.1rem", marginTop: 26 }}>Complaints waiting to be decided</h2>
        {open.length === 0 ? (
          <p className="muted">Nothing waiting.</p>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {open.map((c) => {
              const them = accused(c);
              const from = byId.get(s(c.raised_by));
              return (
                <div className="card" key={s(c.id)} style={{ borderLeft: "4px solid #b45309" }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                    <strong style={{ wordBreak: "break-all" }}>
                      <a href={s(c.against_url)} target="_blank" rel="noopener noreferrer">{s(c.against_url)}</a>
                    </strong>
                    <span className="muted" style={{ fontSize: ".8rem", marginLeft: "auto" }}>{when(c.created_at)}</span>
                  </div>

                  <p style={{ margin: "8px 0 4px", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{s(c.what_happened)}</p>

                  <p className="muted" style={{ fontSize: ".82rem", margin: "4px 0" }}>
                    {them
                      ? <>Their account here: <strong>{who(them)}</strong>{them.email ? ` · ${s(them.email)}` : ""}{them.phone ? ` · ${s(them.phone)}` : ""}</>
                      : <>No supporter account matches that address — it may be somebody who is not registered with us.</>}
                    {from ? <> · Reported by {name(from)}</> : null}
                  </p>

                  {c.evidence_url ? (
                    <p style={{ margin: "6px 0" }}>
                      <a href={s(c.evidence_url)} target="_blank" rel="noopener noreferrer" className="btn small secondary" style={{ fontSize: ".85rem" }}>
                        ▶ Open the evidence they sent
                      </a>
                    </p>
                  ) : (
                    <p className="muted" style={{ fontSize: ".8rem", margin: "6px 0" }}>No evidence was attached.</p>
                  )}

                  {/* Separate forms, side by side. Never nested — a form inside a
                      form is dropped by the browser and the page dies silently. */}
                  <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                    <form action={decideComplaint} style={{ display: "grid", gap: 8 }}>
                      <input type="hidden" name="id" value={s(c.id)} />
                      <input name="note" placeholder="What you found when you looked (the reporter sees this)" />
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button className="btn small" name="verdict" value="upheld" type="submit">✓ Upheld — this is real</button>
                        <button className="btn small secondary" name="verdict" value="rejected" type="submit">✕ Not upheld</button>
                      </div>
                    </form>

                    {them ? (
                      them.supporter_blocked_at ? (
                        <p className="muted" style={{ fontSize: ".82rem", margin: 0 }}>
                          This seller is already on hold since {when(them.supporter_blocked_at)}.
                        </p>
                      ) : (
                        <form action={holdSupporter} style={{ display: "grid", gap: 8, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                          <input type="hidden" name="id" value={s(them.id)} />
                          <input
                            name="reason"
                            required
                            defaultValue={`On ${s(c.against_url)} — ${s(c.what_happened).slice(0, 160)}`}
                            placeholder="The reason, in words the seller will read"
                          />
                          <SubmitButton className="btn small" style={{ background: "#b91c1c", borderColor: "#b91c1c" }}>⛔ Put {name(them)} on hold</SubmitButton>
                        </form>
                      )
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── What the nightly read found ────────────────────────────────── */}
        <h2 style={{ fontSize: "1.1rem", marginTop: 30 }}>What reading their websites found</h2>
        <p className="muted" style={{ fontSize: ".85rem", marginTop: -6 }}>
          Every supporter&apos;s site is read on a rota each night — the home page, and the product
          and combo pages linked from it or listed in their sitemap, because a combo is never on the
          home page. Only the newest read of each site is shown.
        </p>
        {flagged.length === 0 ? (
          <p className="muted">Nothing found against the rules on the last read of any site.</p>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {flagged.map((c) => {
              const them = byId.get(s(c.supporter_id));
              return (
                <div className="card" key={s(c.id)} style={{ borderLeft: "4px solid #b91c1c" }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                    <strong>{name(them) || s(c.supporter_id)}</strong>
                    <span className="badge">{PROBLEM_LABEL[s(c.problem)] ?? s(c.problem)}</span>
                    <span className="muted" style={{ fontSize: ".8rem", marginLeft: "auto" }}>{when(c.checked_at)}</span>
                  </div>
                  <p style={{ margin: "6px 0 2px", lineHeight: 1.6 }}>{s(c.detail)}</p>
                  <p style={{ margin: "2px 0", fontSize: ".85rem", wordBreak: "break-all" }}>
                    <a href={s(c.url)} target="_blank" rel="noopener noreferrer">{s(c.url)}</a>
                  </p>
                  {c.evidence ? (
                    <blockquote className="muted" style={{ fontSize: ".82rem", borderLeft: "3px solid var(--border)", margin: "8px 0 0", padding: "2px 0 2px 10px", lineHeight: 1.6 }}>
                      …{s(c.evidence)}…
                    </blockquote>
                  ) : null}

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                    <form action={recheckSupporterSite}>
                      <input type="hidden" name="id" value={s(c.supporter_id)} />
                      <SubmitButton className="btn small secondary" savedLabel="Read again">↻ Read it again now</SubmitButton>
                    </form>
                  </div>

                  {them && !them.supporter_blocked_at ? (
                    <form action={holdSupporter} style={{ display: "grid", gap: 8, marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                      <input type="hidden" name="id" value={s(c.supporter_id)} />
                      <input name="reason" required defaultValue={`${s(c.detail)} Seen on ${s(c.url)}.`} />
                      <SubmitButton className="btn small" style={{ background: "#b91c1c", borderColor: "#b91c1c" }}>⛔ Put this account on hold</SubmitButton>
                    </form>
                  ) : them?.supporter_blocked_at ? (
                    <p className="muted" style={{ fontSize: ".82rem", marginTop: 8 }}>Already on hold since {when(them.supporter_blocked_at)}.</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {/* ── On hold ────────────────────────────────────────────────────── */}
        <h2 style={{ fontSize: "1.1rem", marginTop: 30 }}>Accounts on hold</h2>
        {held.length === 0 ? (
          <p className="muted">Nobody is on hold.</p>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {held.map((x) => (
              <div className="card" key={s(x.id)}>
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <strong>{who(x)}</strong>
                  <span className="muted" style={{ fontSize: ".82rem" }}>{s(x.email)}{x.phone ? ` · ${s(x.phone)}` : ""}</span>
                  <span className="muted" style={{ fontSize: ".8rem", marginLeft: "auto" }}>Since {when(x.supporter_blocked_at)}</span>
                </div>
                <p className="muted" style={{ margin: "6px 0", lineHeight: 1.6, fontSize: ".88rem" }}>{s(x.supporter_block_reason)}</p>
                {x.supporter_hold_auto ? (
                  <>
                    <p style={{ margin: "6px 0", fontSize: ".84rem", lineHeight: 1.7 }}>
                      🤖 <strong>Decided automatically</strong> from what was on their page.
                    </p>
                    {x.supporter_hold_evidence ? (
                      <p className="muted" style={{ margin: "2px 0 8px", fontSize: ".84rem", fontStyle: "italic", lineHeight: 1.6 }}>
                        On the page: “{s(x.supporter_hold_evidence)}”
                      </p>
                    ) : null}
                  </>
                ) : null}

                {/* TWO WAYS OUT, AND THEY MEAN OPPOSITE THINGS.
                    One says they paid. The other says we were wrong — and that
                    one has to be here, in reach, because the check decides on
                    its own now and will misread a page eventually. A vendor who
                    has done nothing wrong must not have to pay ₹5,000 to be
                    heard. */}
                <form action={releaseSupporter} style={{ marginTop: 8, display: "grid", gap: 8 }}>
                  <input type="hidden" name="id" value={s(x.id)} />
                  <input name="note" placeholder="A line for them, if you want one (optional)" style={{ marginBottom: 0 }} />
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <SubmitButton className="btn" savedLabel="✓ Released">✓ Penalty settled — let them order again</SubmitButton>
                    <button className="btn secondary" name="waive" value="1" type="submit">
                      ↩️ Wrongly held — release, no penalty
                    </button>
                  </div>
                </form>
              </div>
            ))}
          </div>
        )}

        {/* ── Everyone, and where their site stands ──────────────────────── */}
        <h2 style={{ fontSize: "1.1rem", marginTop: 30 }}>Every supporter&apos;s website</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={{ minWidth: 720, width: "100%", borderCollapse: "collapse", fontSize: ".88rem" }}>
            <thead>
              <tr>
                <th style={TH}>Supporter</th><th style={TH}>Website</th><th style={TH}>Verified</th><th style={TH}>Last read</th><th style={TH}></th>
              </tr>
            </thead>
            <tbody>
              {sellers.map((x) => {
                const last = latest.get(s(x.id));
                return (
                  <tr key={s(x.id)}>
                    <td style={TD}>
                      {who(x)}
                      {x.supporter_blocked_at ? <span className="badge" style={{ marginLeft: 6 }}>on hold</span> : null}
                    </td>
                    <td style={{ ...TD, wordBreak: "break-all", maxWidth: 260 }}>
                      {x.supporter_site
                        ? <a href={s(x.supporter_site)} target="_blank" rel="noopener noreferrer">{s(x.supporter_site)}</a>
                        : <span className="muted">none on file</span>}
                    </td>
                    {/* HOW they came to be verified, not merely whether. A site
                        the office vouched for is trusted; a site that answered
                        with our code is proved, and only that one can cost the
                        vendor a penalty on what the nightly read finds. */}
                    <td style={TD}>
                      {x.supporter_site_ok_at
                        ? s(x.supporter_site_proof) === "admin"
                          ? <>✓ <span className="muted" style={{ fontSize: ".8rem" }}>vouched</span></>
                          : <>✓ <span className="muted" style={{ fontSize: ".8rem" }}>code</span></>
                        : <span className="muted">no</span>}
                    </td>
                    <td style={{ ...TD, fontSize: ".82rem" }}>
                      {last
                        ? <>{when(last.checked_at)}<br /><span className="muted">{last.ok ? "clean" : (PROBLEM_LABEL[s(last.problem)] ?? s(last.problem))}</span></>
                        : <span className="muted">never</span>}
                    </td>
                    <td style={TD}>
                      {x.supporter_site ? (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <form action={recheckSupporterSite}>
                            <input type="hidden" name="id" value={s(x.id)} />
                            <SubmitButton className="btn small secondary" savedLabel="done">Read now</SubmitButton>
                          </form>
                          {/* For the vendor you know perfectly well, who should
                              not be kept from selling while somebody at their
                              end works out how to edit a footer. */}
                          {!x.supporter_site_ok_at && (
                            <form action={clearSupporterSiteByHand}>
                              <input type="hidden" name="id" value={s(x.id)} />
                              <SubmitButton className="btn small" savedLabel="cleared">This is their site</SubmitButton>
                            </form>
                          )}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {unreachable.length > 0 && (
          <p className="muted" style={{ fontSize: ".82rem", marginTop: 8 }}>
            {unreachable.length} site{unreachable.length === 1 ? " did" : "s did"} not answer on the last
            read. That is usually their host, not evasion — nothing is held for it.
          </p>
        )}

        {/* ── Already decided ────────────────────────────────────────────── */}
        {settled.length > 0 && (
          <>
            <h2 style={{ fontSize: "1.1rem", marginTop: 30 }}>Complaints already decided</h2>
            <div style={{ display: "grid", gap: 8 }}>
              {settled.map((c) => (
                <div className="card" key={s(c.id)}>
                  <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                    <span className="badge">{s(c.status) === "upheld" ? "Upheld" : "Not upheld"}</span>
                    <span style={{ fontSize: ".88rem", wordBreak: "break-all" }}>{s(c.against_url)}</span>
                    <span className="muted" style={{ fontSize: ".8rem", marginLeft: "auto" }}>{when(c.reviewed_at)}</span>
                  </div>
                  {c.outcome_note ? <p className="muted" style={{ margin: "4px 0 0", fontSize: ".85rem" }}>{s(c.outcome_note)}</p> : null}
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
