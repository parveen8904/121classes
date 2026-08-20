import Link from "next/link";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import AdminHero from "../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import { ASSET_TYPES, assetViewer, assetXirr, dmy, handledAssetIds, inr, istToday, signAssetPath } from "@/lib/assets";
import { createAsset } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Assets — Admin" };

// THE ASSET REGISTER. Discussed before it was built (20 Aug 2026): the founder
// sees everything; a handler opening this same page sees only the assets
// assigned to them, with ownership, valuations and returns absent — not
// hidden by CSS, absent from the HTML.

export default async function AssetsPage(props: { searchParams: Promise<{ err?: string }> }) {
  const v = await assetViewer();
  if (!v) redirect("/admin");
  const sp = await props.searchParams;
  const svc = createServiceClient();
  const isAdmin = v.role === "admin";
  // The editor enters the data, so he sees what he enters (owners, invested,
  // contract) — but the computed actual return stays the founder's alone.
  const canEdit = isAdmin || v.role === "editor";

  let q = svc.from("assets").select("*").order("status").order("name");
  if (v.role === "handler") {
    const ids = await handledAssetIds(v.staff.id);
    if (ids.length === 0) {
      return (
        <section className="container" style={{ paddingTop: 30, maxWidth: 900 }}>
          <AdminHero badge="🏠 Assets" title="Assets" subtitle="No asset is assigned to you yet." back={{ href: "/admin", label: "Admin" }} />
        </section>
      );
    }
    q = q.in("id", ids);
  }
  const { data: assets } = await q;
  const list = assets ?? [];
  const assetIds = list.map((a) => String(a.id));

  const today = istToday();
  const [{ data: owners }, { data: pend }, { data: photos }, { data: txns }] = await Promise.all([
    canEdit && assetIds.length
      ? svc.from("asset_owners").select("asset_id, owner_name, share_pct").in("asset_id", assetIds)
      : Promise.resolve({ data: [] as { asset_id: string; owner_name: string; share_pct: number }[] }),
    assetIds.length
      ? svc.from("asset_occurrences").select("asset_id").eq("status", "pending").lte("due_on", today).in("asset_id", assetIds)
      : Promise.resolve({ data: [] as { asset_id: string }[] }),
    assetIds.length
      ? svc.from("asset_docs").select("asset_id, path").eq("kind", "photo").in("asset_id", assetIds)
      : Promise.resolve({ data: [] as { asset_id: string; path: string }[] }),
    isAdmin && assetIds.length
      ? svc.from("asset_txns").select("asset_id, on_date, direction, amount").in("asset_id", assetIds)
      : Promise.resolve({ data: [] as { asset_id: string; on_date: string; direction: string; amount: number }[] }),
  ]);

  const ownersBy = new Map<string, string[]>();
  for (const o of owners ?? []) {
    const k = String(o.asset_id);
    ownersBy.set(k, [...(ownersBy.get(k) ?? []), `${o.owner_name} ${Number(o.share_pct)}%`]);
  }
  const pendBy = new Map<string, number>();
  for (const p of pend ?? []) pendBy.set(String(p.asset_id), (pendBy.get(String(p.asset_id)) ?? 0) + 1);
  const txnsBy = new Map<string, { on_date: string; direction: string; amount: number }[]>();
  for (const t of txns ?? []) {
    const k = String(t.asset_id);
    txnsBy.set(k, [...(txnsBy.get(k) ?? []), t]);
  }
  const firstPhoto = new Map<string, string>();
  for (const p of photos ?? []) if (!firstPhoto.has(String(p.asset_id))) firstPhoto.set(String(p.asset_id), String(p.path));
  const photoUrls = new Map<string, string>();
  await Promise.all([...firstPhoto.entries()].map(async ([id, path]) => {
    const u = await signAssetPath(path);
    if (u) photoUrls.set(id, u);
  }));

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 1000 }}>
      <AdminHero
        badge="🏠 Assets"
        title="The asset register"
        subtitle={isAdmin
          ? "Every asset, its people, its money and its duties — with returns computed from the actual cash flows. 📈"
          : "The assets assigned to you, and the work on them."}
        back={{ href: "/admin", label: "Admin" }}
      />

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "14px 0" }}>
        <Link className="btn small secondary" href="/admin/assets/work">📋 My work — due & overdue</Link>
        {(isAdmin || v.role === "accounts" || v.role === "editor") && (
          <Link className="btn small secondary" href="/admin/assets/accounts">🧾 Accounts — verify & pendency</Link>
        )}
        {isAdmin && <Link className="btn small secondary" href="/admin/assets/owners">👥 Owner statements</Link>}
      </div>

      {sp.err === "name" && <div className="notice err">The asset needs a name.</div>}

      <div style={{ display: "grid", gap: 10 }}>
        {list.map((a) => {
          const id = String(a.id);
          const overdue = pendBy.get(id) ?? 0;
          const x = isAdmin ? assetXirr(a as never, txnsBy.get(id) ?? []) : null;
          return (
            <Link key={id} href={`/admin/assets/${id}`} className="card" style={{ display: "flex", gap: 14, alignItems: "center", textDecoration: "none", color: "inherit", opacity: a.status === "closed" ? 0.6 : 1 }}>
              {photoUrls.has(id) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoUrls.get(id)} alt="" style={{ width: 72, height: 54, objectFit: "cover", borderRadius: 8, flexShrink: 0 }} />
              ) : (
                <div style={{ width: 72, height: 54, borderRadius: 8, background: "var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.4rem", flexShrink: 0 }}>🏠</div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{String(a.name)}</strong>{" "}
                <span className="muted" style={{ fontSize: ".8rem" }}>· {String(a.type)}{a.status === "closed" ? ` · closed (${a.closed_kind}, ${dmy(a.closed_on as string)})` : ""}</span>
                <div className="muted" style={{ fontSize: ".8rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {String(a.address ?? "")}
                  {canEdit && ownersBy.has(id) ? ` · ${ownersBy.get(id)!.join(", ")}` : ""}
                </div>
              </div>
              {canEdit && (
                <div style={{ textAlign: "right", fontSize: ".82rem", flexShrink: 0 }}>
                  <div>{inr(a.invested_amount as number)} invested</div>
                  <div className="muted">
                    contract {a.contractual_return != null ? `${a.contractual_return}%` : "—"}
                    {isAdmin ? ` · actual ${x?.rate != null ? `${(x.rate * 100).toFixed(1)}%` : "—"}` : ""}
                  </div>
                </div>
              )}
              {overdue > 0 && (
                <span style={{ background: "#b45309", color: "#fff", borderRadius: 12, padding: "2px 10px", fontSize: ".78rem", fontWeight: 700, flexShrink: 0 }}>
                  {overdue} overdue
                </span>
              )}
            </Link>
          );
        })}
        {list.length === 0 && <div className="card"><p className="muted" style={{ margin: 0 }}>No assets yet.</p></div>}
      </div>

      {canEdit && (
        <details className="form-card" style={{ marginTop: 20 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>➕ New asset</summary>
          <form action={createAsset} style={{ marginTop: 10, display: "grid", gap: 8 }}>
            <label>Name</label>
            <input name="name" required placeholder="Karol Bagh shop / SBI FD 2027 …" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label>Type</label>
                <select name="type">{ASSET_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
              </div>
              <div>
                <label>Address / identifier</label>
                <input name="address" placeholder="address, folio, FD number…" />
              </div>
              <div>
                <label>Date of investment</label>
                <input type="date" name="invested_on" />
              </div>
              <div>
                <label>Date of maturity (if any)</label>
                <input type="date" name="matures_on" />
              </div>
              <div>
                <label>Amount invested (₹)</label>
                <input name="invested_amount" inputMode="numeric" placeholder="2500000" />
              </div>
              <div>
                <label>Return as per contract (% p.a.)</label>
                <input name="contractual_return" inputMode="decimal" placeholder="7.5" />
              </div>
            </div>
            <label>Notes</label>
            <textarea name="notes" rows={2} />
            <SubmitButton className="btn">Create the asset</SubmitButton>
          </form>
        </details>
      )}
    </section>
  );
}
