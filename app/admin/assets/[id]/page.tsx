import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import {
  ASSET_TYPES, TXN_NATURES_IN, TXN_NATURES_OUT, assetViewer, assetXirr,
  assignableStaff, dmy, handledAssetIds, inr, istToday, signAssetPath,
} from "@/lib/assets";
import {
  addLetter, addOwner, addTask, addTxn, closeAsset, closeLetter, deleteAssetFile,
  removeOwner, saveTenancy, setHandler, setTaskAssignee, toggleTask, updateAsset,
  uploadAssetFile, verifyTxn,
} from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Asset — Admin" };

// ONE PAGE PER ASSET: its photographs, papers, people, money, duties and
// letters — the founder's whole file. What a viewer's role must not see is
// never rendered: a handler gets no owners, no valuation, no returns.

export default async function AssetFilePage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ err?: string }>;
}) {
  const v = await assetViewer();
  if (!v) redirect("/admin");
  const { id } = await props.params;
  const sp = await props.searchParams;
  const isAdmin = v.role === "admin";
  const canVerify = isAdmin || v.role === "accounts";

  if (v.role === "handler") {
    const ids = await handledAssetIds(v.staff.id);
    if (!ids.includes(id)) redirect("/admin/assets");
  }

  const svc = createServiceClient();
  const { data: a } = await svc.from("assets").select("*").eq("id", id).maybeSingle();
  if (!a) notFound();

  const [
    { data: owners }, { data: docs }, { data: tenancy }, { data: tasks },
    { data: occs }, { data: txns }, { data: letters }, { data: handlers }, staff,
  ] = await Promise.all([
    isAdmin ? svc.from("asset_owners").select("*").eq("asset_id", id).order("share_pct", { ascending: false }) : Promise.resolve({ data: [] }),
    svc.from("asset_docs").select("*").eq("asset_id", id).order("created_at", { ascending: false }),
    svc.from("asset_tenancy").select("*").eq("asset_id", id).maybeSingle(),
    svc.from("asset_tasks").select("*").eq("asset_id", id).order("created_at"),
    svc.from("asset_occurrences").select("*").eq("asset_id", id).order("due_on", { ascending: false }).limit(60),
    svc.from("asset_txns").select("*").eq("asset_id", id).order("on_date", { ascending: false }).limit(200),
    svc.from("asset_letters").select("*").eq("asset_id", id).order("created_at", { ascending: false }),
    isAdmin ? svc.from("asset_handlers").select("user_id").eq("asset_id", id) : Promise.resolve({ data: [] }),
    assignableStaff(),
  ]);

  const staffName = new Map(staff.map((s) => [s.id, s.name]));
  const handlerIds = new Set((handlers ?? []).map((h) => String((h as unknown as { user_id: string }).user_id)));
  const today = istToday();

  const signed = new Map<string, string>();
  await Promise.all([
    ...(docs ?? []).map(async (d) => { const u = await signAssetPath(String(d.path)); if (u) signed.set(String(d.path), u); }),
    ...(txns ?? []).filter((t) => t.doc_path).map(async (t) => { const u = await signAssetPath(String(t.doc_path)); if (u) signed.set(String(t.doc_path), u); }),
    ...(letters ?? []).filter((l) => l.file_path).map(async (l) => { const u = await signAssetPath(String(l.file_path)); if (u) signed.set(String(l.file_path), u); }),
    (async () => { if (tenancy?.agreement_path) { const u = await signAssetPath(String(tenancy.agreement_path)); if (u) signed.set(String(tenancy.agreement_path), u); } })(),
  ]);

  const photos = (docs ?? []).filter((d) => d.kind === "photo");
  const papers = (docs ?? []).filter((d) => d.kind !== "photo");
  const x = isAdmin ? assetXirr(a as never, (txns ?? []) as never) : null;
  const closed = a.status === "closed";

  const staffSelect = (name: string, current?: string | null) => (
    <select name={name} defaultValue={current ?? ""}>
      <option value="">— nobody —</option>
      {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );

  const txnFields = (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}>
      <div><label>Date</label><input type="date" name="on_date" defaultValue={today} required /></div>
      <div>
        <label>Nature</label>
        <select name="nature">
          {TXN_NATURES_IN.map((n) => <option key={n}>{n}</option>)}
          {TXN_NATURES_OUT.map((n) => <option key={n}>{n}</option>)}
        </select>
      </div>
      <div>
        <label>Money</label>
        <select name="direction"><option value="in">came in</option><option value="out">went out</option></select>
      </div>
      <div><label>Amount (₹)</label><input name="amount" inputMode="numeric" required /></div>
      <div><label>GST (₹)</label><input name="gst" inputMode="numeric" placeholder="0" /></div>
      <div><label>TDS deducted (₹)</label><input name="tds" inputMode="numeric" placeholder="0" /></div>
    </div>
  );

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 1000 }}>
      <AdminHero
        badge={closed ? "🏠 Closed asset" : "🏠 Asset"}
        title={String(a.name)}
        subtitle={`${a.type}${a.address ? " · " + a.address : ""}`}
        back={{ href: "/admin/assets", label: "Assets" }}
      />
      {sp.err === "txn" && <div className="notice err" style={{ marginTop: 12 }}>The transaction needs a date and an amount.</div>}
      {sp.err === "nofile" && <div className="notice err" style={{ marginTop: 12 }}>Choose a file first.</div>}
      {closed && (
        <div className="notice" style={{ marginTop: 12 }}>
          Closed by {String(a.closed_kind)} on {dmy(a.closed_on as string)}
          {a.sold_to ? ` — to ${a.sold_to}` : ""}{a.sale_amount ? ` for ${inr(a.sale_amount as number)}` : ""}. Read-only history.
        </div>
      )}

      {/* ── Photos ─────────────────────────────────────────────────────── */}
      {photos.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
          {photos.map((p) => (
            <a key={String(p.id)} href={signed.get(String(p.path))} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={signed.get(String(p.path))} alt={String(p.title ?? "photo")} style={{ height: 110, borderRadius: 10, objectFit: "cover" }} />
            </a>
          ))}
        </div>
      )}

      {/* ── The facts, and (founder only) the returns ──────────────────── */}
      <div className="card" style={{ marginTop: 14, display: "flex", gap: 24, flexWrap: "wrap", fontSize: ".88rem" }}>
        <div>📅 Invested {dmy(a.invested_on as string)}{a.matures_on ? ` · matures ${dmy(a.matures_on as string)}` : ""}</div>
        {isAdmin && <div>💰 {inr(a.invested_amount as number)} invested</div>}
        {isAdmin && (
          <div>
            📈 Contract: <strong>{a.contractual_return != null ? `${a.contractual_return}% p.a.` : "—"}</strong>
            {" · "}Actual (XIRR): <strong>{x?.rate != null ? `${(x.rate * 100).toFixed(2)}% p.a.` : "—"}</strong>
            {x?.rate == null && x?.why && <span className="muted"> ({x.why})</span>}
          </div>
        )}
        {isAdmin && a.current_value != null && (
          <div className="muted">valued {inr(a.current_value as number)} on {dmy(a.current_value_on as string)}</div>
        )}
      </div>

      {/* ── Owners (founder only) ──────────────────────────────────────── */}
      {isAdmin && (
        <div className="card" style={{ marginTop: 12 }}>
          <strong>👥 Owners</strong>
          <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {(owners ?? []).map((o) => (
              <div className="list-row" key={String(o.id)}>
                <span className="row-title">{String(o.owner_name)}</span>
                <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <strong>{Number(o.share_pct)}%</strong>
                  <form action={removeOwner}>
                    <input type="hidden" name="id" value={String(o.id)} />
                    <input type="hidden" name="asset_id" value={id} />
                    <button className="btn small ghost" type="submit">✕</button>
                  </form>
                </span>
              </div>
            ))}
            {(owners ?? []).length === 0 && <p className="muted" style={{ margin: 0, fontSize: ".84rem" }}>No owners recorded — add them so the owner statements can split income and expenses.</p>}
          </div>
          {!closed && (
            <form action={addOwner} style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "end" }}>
              <input type="hidden" name="asset_id" value={id} />
              <div><label>Owner</label><input name="owner_name" placeholder="name" required /></div>
              <div><label>Share %</label><input name="share_pct" inputMode="decimal" style={{ width: 90 }} required /></div>
              <SubmitButton className="btn small">Add owner</SubmitButton>
            </form>
          )}
        </div>
      )}

      {/* ── Handlers (founder only) ────────────────────────────────────── */}
      {isAdmin && (
        <div className="card" style={{ marginTop: 12 }}>
          <strong>🧑‍💼 Who handles this asset</strong>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            {staff.map((s) => (
              <form action={setHandler} key={s.id}>
                <input type="hidden" name="asset_id" value={id} />
                <input type="hidden" name="user_id" value={s.id} />
                <input type="hidden" name="on" value={handlerIds.has(s.id) ? "0" : "1"} />
                <button className={`btn small ${handlerIds.has(s.id) ? "" : "secondary"}`} type="submit">
                  {handlerIds.has(s.id) ? "✓ " : ""}{s.name}
                </button>
              </form>
            ))}
          </div>
          <p className="muted" style={{ fontSize: ".78rem", margin: "8px 0 0" }}>A handler sees this asset and its tasks — never its owners, value or returns.</p>
        </div>
      )}

      {/* ── Tenancy (rental machinery) ─────────────────────────────────── */}
      {(isAdmin || tenancy) && (
        <div className="card" style={{ marginTop: 12 }}>
          <strong>🔑 Tenancy</strong>
          {tenancy ? (
            <p style={{ fontSize: ".88rem", margin: "6px 0 0" }}>
              {String(tenancy.tenant_name ?? "—")} · rent <strong>{inr(tenancy.monthly_rent as number)}</strong> by the {String(tenancy.rent_due_day)}th ·
              agreement {dmy(tenancy.agreement_date as string)} → <strong>{dmy(tenancy.agreement_expiry as string)}</strong>
              {tenancy.agreement_path && <> · <a href={signed.get(String(tenancy.agreement_path))} target="_blank" rel="noreferrer">📄 agreement</a></>}
            </p>
          ) : (
            <p className="muted" style={{ fontSize: ".84rem", margin: "6px 0 0" }}>No tenancy recorded.</p>
          )}
          {isAdmin && !closed && (
            <details style={{ marginTop: 8 }}>
              <summary className="muted" style={{ cursor: "pointer", fontSize: ".84rem" }}>✏️ {tenancy ? "Edit tenancy" : "Add tenancy"} — the monthly rent task maintains itself from this</summary>
              <form action={saveTenancy} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 8, marginTop: 8 }}>
                <input type="hidden" name="asset_id" value={id} />
                <div><label>Tenant</label><input name="tenant_name" defaultValue={String(tenancy?.tenant_name ?? "")} /></div>
                <div><label>Monthly rent (₹)</label><input name="monthly_rent" inputMode="numeric" defaultValue={tenancy?.monthly_rent != null ? String(tenancy.monthly_rent) : ""} /></div>
                <div><label>Rent due by day</label><input name="rent_due_day" inputMode="numeric" defaultValue={String(tenancy?.rent_due_day ?? 5)} /></div>
                <div><label>Agreement date</label><input type="date" name="agreement_date" defaultValue={String(tenancy?.agreement_date ?? "")} /></div>
                <div><label>Agreement expiry</label><input type="date" name="agreement_expiry" defaultValue={String(tenancy?.agreement_expiry ?? "")} /></div>
                <div><label>Agreement (PDF)</label><input type="file" name="agreement" accept="application/pdf,image/*" /></div>
                <SubmitButton className="btn small">Save tenancy</SubmitButton>
              </form>
            </details>
          )}
        </div>
      )}

      {/* ── Tasks ──────────────────────────────────────────────────────── */}
      <h2 className="admin-section-title">✅ Standing tasks</h2>
      <div style={{ display: "grid", gap: 8 }}>
        {(tasks ?? []).map((t) => (
          <div className="card" key={String(t.id)} style={{ opacity: t.active ? 1 : 0.55 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <strong>{String(t.title)}</strong>
              <span className="muted" style={{ fontSize: ".8rem" }}>
                {String(t.cadence)}{t.cadence === "monthly" ? ` · by the ${t.due_day}th` : t.anchor_date ? ` · ${dmy(t.anchor_date as string)}` : ""}
                {t.expected_amount != null ? ` · expect ${inr(t.expected_amount as number)}` : ""}
                {t.from_tenancy ? " · from tenancy" : ""}
              </span>
              <span style={{ marginLeft: "auto", fontSize: ".8rem" }}>
                {t.assigned_to ? `👤 ${staffName.get(String(t.assigned_to)) ?? "?"}` : <span style={{ color: "#b45309", fontWeight: 700 }}>unassigned</span>}
              </span>
              {isAdmin && (
                <form action={toggleTask}>
                  <input type="hidden" name="id" value={String(t.id)} />
                  <input type="hidden" name="asset_id" value={id} />
                  <button className="btn small ghost" type="submit">{t.active ? "pause" : "resume"}</button>
                </form>
              )}
            </div>
            {isAdmin && (
              <form action={setTaskAssignee} style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "end" }}>
                <input type="hidden" name="id" value={String(t.id)} />
                <input type="hidden" name="asset_id" value={id} />
                <div><label style={{ fontSize: ".76rem" }}>Assigned to</label>{staffSelect("assigned_to", t.assigned_to ? String(t.assigned_to) : null)}</div>
                <SubmitButton className="btn small secondary">Set</SubmitButton>
              </form>
            )}
          </div>
        ))}
        {(tasks ?? []).length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>No standing tasks.</p></div>}
      </div>
      {isAdmin && !closed && (
        <details className="form-card" style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>➕ New standing task</summary>
          <form action={addTask} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 8, marginTop: 8 }}>
            <input type="hidden" name="asset_id" value={id} />
            <div><label>Task</label><input name="title" placeholder="Payment of house tax" required /></div>
            <div>
              <label>Becomes a transaction of nature</label>
              <select name="nature">
                {TXN_NATURES_OUT.map((n) => <option key={n}>{n}</option>)}
                {TXN_NATURES_IN.map((n) => <option key={n}>{n}</option>)}
              </select>
            </div>
            <div><label>Money</label><select name="direction"><option value="out">goes out</option><option value="in">comes in</option></select></div>
            <div><label>Rhythm</label><select name="cadence"><option>monthly</option><option>annual</option><option>once</option></select></div>
            <div><label>Monthly: due by day</label><input name="due_day" inputMode="numeric" placeholder="5" /></div>
            <div><label>Annual/once: the date</label><input type="date" name="anchor_date" /></div>
            <div><label>Expected amount (₹)</label><input name="expected_amount" inputMode="numeric" /></div>
            <div><label>Assigned to</label>{staffSelect("assigned_to")}</div>
            <SubmitButton className="btn small">Add task</SubmitButton>
          </form>
        </details>
      )}

      {/* ── Occurrences (recent) ───────────────────────────────────────── */}
      {(occs ?? []).length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary className="muted" style={{ cursor: "pointer", fontSize: ".86rem" }}>🗓️ Recent occurrences ({(occs ?? []).length})</summary>
          <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {(occs ?? []).map((o) => {
              const t = (tasks ?? []).find((tt) => String(tt.id) === String(o.task_id));
              const late = o.status === "pending" && String(o.due_on) < today;
              return (
                <div className="list-row" key={String(o.id)}>
                  <span className="row-title">{t ? String(t.title) : "task"} · due {dmy(String(o.due_on))}</span>
                  <span style={{ color: late ? "#b45309" : undefined, fontWeight: late ? 700 : undefined }}>
                    {o.status === "done" ? "✅ done" : o.status === "skipped" ? "— skipped" : late ? "⌛ overdue" : "⏳ pending"}
                  </span>
                </div>
              );
            })}
          </div>
        </details>
      )}

      {/* ── Transactions ───────────────────────────────────────────────── */}
      <h2 className="admin-section-title">💸 Transactions</h2>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: ".85rem" }}>
          <thead><tr>{["Date", "Nature", "Amount", "GST", "TDS", "Proof", "Status"].map((h) => <th key={h} style={{ textAlign: "left", padding: "6px 8px", color: "var(--muted)" }}>{h}</th>)}</tr></thead>
          <tbody>
            {(txns ?? []).map((t) => (
              <tr key={String(t.id)} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{dmy(String(t.on_date))}</td>
                <td style={{ padding: "6px 8px" }}>{String(t.nature)}{t.note ? <div className="muted" style={{ fontSize: ".76rem" }}>{String(t.note)}</div> : null}
                  {t.accounts_query ? <div style={{ color: "#b45309", fontSize: ".78rem", fontWeight: 700 }}>❓ accounts: {String(t.accounts_query)}</div> : null}</td>
                <td style={{ padding: "6px 8px", whiteSpace: "nowrap", color: t.direction === "out" ? "#b91c1c" : undefined }}>{t.direction === "out" ? "−" : "+"}{inr(t.amount as number)}</td>
                <td style={{ padding: "6px 8px" }}>{Number(t.gst) ? inr(t.gst as number) : "—"}</td>
                <td style={{ padding: "6px 8px" }}>{Number(t.tds) ? inr(t.tds as number) : "—"}</td>
                <td style={{ padding: "6px 8px" }}>{t.doc_path ? <a href={signed.get(String(t.doc_path))} target="_blank" rel="noreferrer">📎</a> : "—"}</td>
                <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                  {t.verified_at ? "✅ verified" : canVerify ? (
                    <form action={verifyTxn} style={{ display: "inline" }}>
                      <input type="hidden" name="id" value={String(t.id)} />
                      <input type="hidden" name="back" value={`/admin/assets/${id}`} />
                      <button className="btn small secondary" type="submit">verify</button>
                    </form>
                  ) : "⏳"}
                </td>
              </tr>
            ))}
            {(txns ?? []).length === 0 && <tr><td colSpan={7} className="muted" style={{ padding: 10 }}>No transactions yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {!closed && (
        <details className="form-card" style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>➕ Record a transaction</summary>
          <form action={addTxn} style={{ display: "grid", gap: 8, marginTop: 8 }}>
            <input type="hidden" name="asset_id" value={id} />
            {txnFields}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div><label>Proof (receipt/statement)</label><input type="file" name="file" /></div>
              <div><label>Note</label><input name="note" /></div>
            </div>
            <SubmitButton className="btn small">Record it — accounts will verify</SubmitButton>
          </form>
        </details>
      )}

      {/* ── Letters ────────────────────────────────────────────────────── */}
      <h2 className="admin-section-title">📬 Letters & notices</h2>
      <div style={{ display: "grid", gap: 8 }}>
        {(letters ?? []).map((l) => (
          <div className="card" key={String(l.id)} style={{ opacity: l.status === "closed" ? 0.6 : 1 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
              <strong>{String(l.title)}</strong>
              <span className="muted" style={{ fontSize: ".8rem" }}>received {dmy(l.received_on as string)}{l.due_on ? ` · act by ${dmy(l.due_on as string)}` : ""}</span>
              {l.file_path && <a href={signed.get(String(l.file_path))} target="_blank" rel="noreferrer">📄 letter</a>}
              <span style={{ marginLeft: "auto", fontSize: ".8rem" }}>
                {l.status === "closed" ? `✅ closed ${l.closed_note ? "— " + l.closed_note : ""}` : `👤 ${l.assigned_to ? staffName.get(String(l.assigned_to)) ?? "?" : "unassigned"}`}
              </span>
            </div>
            {l.action_plan && <p style={{ fontSize: ".86rem", margin: "6px 0 0" }}>{String(l.action_plan)}</p>}
            {l.status === "open" && (
              <form action={closeLetter} style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "end", flexWrap: "wrap" }}>
                <input type="hidden" name="id" value={String(l.id)} />
                <input type="hidden" name="asset_id" value={id} />
                <div style={{ flex: 1, minWidth: 200 }}><label style={{ fontSize: ".76rem" }}>What was done</label><input name="closed_note" /></div>
                <SubmitButton className="btn small secondary">Close it</SubmitButton>
              </form>
            )}
          </div>
        ))}
        {(letters ?? []).length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>No letters on file.</p></div>}
      </div>
      {!closed && (
        <details className="form-card" style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>➕ A letter arrived</summary>
          <form action={addLetter} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 8, marginTop: 8 }}>
            <input type="hidden" name="asset_id" value={id} />
            <div><label>What is it</label><input name="title" placeholder="MCD notice on property tax" required /></div>
            <div><label>Received on</label><input type="date" name="received_on" defaultValue={today} /></div>
            <div><label>Act by</label><input type="date" name="due_on" /></div>
            <div><label>Assigned to</label>{staffSelect("assigned_to")}</div>
            <div><label>Scan</label><input type="file" name="file" /></div>
            <div style={{ gridColumn: "1 / -1" }}><label>Action plan</label><textarea name="action_plan" rows={2} /></div>
            <SubmitButton className="btn small">File the letter</SubmitButton>
          </form>
        </details>
      )}

      {/* ── Papers & photos ────────────────────────────────────────────── */}
      <h2 className="admin-section-title">🗂️ Papers & photographs</h2>
      <div style={{ display: "grid", gap: 6 }}>
        {papers.map((d) => (
          <div className="list-row" key={String(d.id)}>
            <span className="row-title"><a href={signed.get(String(d.path))} target="_blank" rel="noreferrer">📄 {String(d.title || d.path).split("/").pop()}</a></span>
            <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span className="muted" style={{ fontSize: ".78rem" }}>{dmy(String(d.created_at).slice(0, 10))}</span>
              {isAdmin && (
                <form action={deleteAssetFile}>
                  <input type="hidden" name="id" value={String(d.id)} />
                  <input type="hidden" name="asset_id" value={id} />
                  <button className="btn small ghost" type="submit">✕</button>
                </form>
              )}
            </span>
          </div>
        ))}
      </div>
      {!closed && (
        <form action={uploadAssetFile} style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "end" }}>
          <input type="hidden" name="asset_id" value={id} />
          <div><label>Add</label><select name="kind"><option value="document">document</option><option value="photo">photograph</option></select></div>
          <div><label>Title</label><input name="title" placeholder="registry / FD receipt…" /></div>
          <div><label>File</label><input type="file" name="file" required /></div>
          <SubmitButton className="btn small">Upload</SubmitButton>
        </form>
      )}

      {/* ── Edit & close (founder only) ────────────────────────────────── */}
      {isAdmin && !closed && (
        <>
          <details className="form-card" style={{ marginTop: 20 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>✏️ Edit details & valuation</summary>
            <form action={updateAsset} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 8, marginTop: 8 }}>
              <input type="hidden" name="id" value={id} />
              <div><label>Name</label><input name="name" defaultValue={String(a.name)} /></div>
              <div><label>Type</label><select name="type" defaultValue={String(a.type)}>{ASSET_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
              <div style={{ gridColumn: "1 / -1" }}><label>Address / identifier</label><input name="address" defaultValue={String(a.address ?? "")} /></div>
              <div><label>Invested on</label><input type="date" name="invested_on" defaultValue={String(a.invested_on ?? "")} /></div>
              <div><label>Matures on</label><input type="date" name="matures_on" defaultValue={String(a.matures_on ?? "")} /></div>
              <div><label>Amount invested (₹)</label><input name="invested_amount" inputMode="numeric" defaultValue={a.invested_amount != null ? String(a.invested_amount) : ""} /></div>
              <div><label>Contract return (% p.a.)</label><input name="contractual_return" inputMode="decimal" defaultValue={a.contractual_return != null ? String(a.contractual_return) : ""} /></div>
              <div><label>Current value (₹) — feeds actual XIRR</label><input name="current_value" inputMode="numeric" defaultValue={a.current_value != null ? String(a.current_value) : ""} /></div>
              <div><label>Valued on</label><input type="date" name="current_value_on" defaultValue={String(a.current_value_on ?? "")} /></div>
              <div style={{ gridColumn: "1 / -1" }}><label>Notes</label><textarea name="notes" rows={2} defaultValue={String(a.notes ?? "")} /></div>
              <SubmitButton className="btn small">Save</SubmitButton>
            </form>
          </details>

          <details className="form-card" style={{ marginTop: 10 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600, color: "#b45309" }}>🏁 Close the asset — maturity / sale / settlement</summary>
            <form action={closeAsset} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 8, marginTop: 8 }}>
              <input type="hidden" name="id" value={id} />
              <div><label>How</label><select name="closed_kind"><option>sale</option><option>maturity</option><option>settlement</option></select></div>
              <div><label>Date</label><input type="date" name="closed_on" defaultValue={today} required /></div>
              <div><label>Sold to / settled with</label><input name="sold_to" /></div>
              <div><label>For how much (₹)</label><input name="sale_amount" inputMode="numeric" /></div>
              <SubmitButton className="btn small">Close it — the proceeds enter the ledger, tasks stop, history stays</SubmitButton>
            </form>
          </details>
        </>
      )}

      <p style={{ marginTop: 20 }}><Link href="/admin/assets/work">📋 My work</Link>{canVerify && <> · <Link href="/admin/assets/accounts">🧾 Accounts desk</Link></>}</p>
    </section>
  );
}
