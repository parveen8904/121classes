import Link from "next/link";
import AdminHero from "../../_components/AdminHero";
import { assertArea } from "@/lib/adminAccess";
import { zohoConfigured } from "@/lib/zohoApi";
import SubmitButton from "@/app/components/SubmitButton";
import Money from "@/app/components/Money";
import {
  loadYear, loadMap, fyDates,
  PL_BUCKETS, BS_BUCKETS, signed, bsAmount,
  type ReturnPack, type LedgerRow,
} from "@/lib/itrReturn";
import { buildYearAction, setBucketAction, restoreSuggestedMapAction, saveInputsAction } from "./actions";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
export const metadata = { title: "Return builder — Zoho — Admin" };

// THE RETURN BUILDER.
//
// His ask, 29 August 2026: "I want you to make one small software for this
// where I will just put my Zoho profit and loss account and I get all the three
// outputs." The three are the financials (balance sheet and profit and loss),
// the computation of income, and Schedule AL.
//
// It does not replace the accountant. It does the part of his job that is
// arithmetic and completeness, so that the part that is judgement is all he has
// left to argue about. The audit of FY 2025-26 is the reason it exists: every
// error found there was of the kind a machine cannot make — a ledger left out
// of a total, an asset in neither schedule, a figure carried twice.
//
// The mapping table below is the whole thing. Nothing is ever dropped silently:
// a ledger with no destination is listed in red at the top until somebody says
// where it goes.

const FYS = ["2026-27", "2025-26", "2024-25"];

function Row({ label, value, bold, indent }: { label: string; value: number | null; bold?: boolean; indent?: boolean }) {
  return (
    <tr>
      <td style={{ paddingLeft: indent ? 22 : 6, fontWeight: bold ? 600 : 400 }}>{label}</td>
      <td style={{ textAlign: "right", fontWeight: bold ? 600 : 400 }}>
        {value === null ? "" : <Money n={value} width={130} />}
      </td>
    </tr>
  );
}

export default async function ItrBuilderPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string; tab?: string }>;
}) {
  await assertArea("zoho");
  const sp = await searchParams;
  const fy = FYS.includes(sp.fy ?? "") ? sp.fy! : "2025-26";
  const tab = sp.tab ?? "outputs";

  const connected = await zohoConfigured();
  const [{ inputs, snapshot, builtAt }, map] = await Promise.all([loadYear(fy), loadMap()]);
  const pack: ReturnPack | null = snapshot;
  const { from, to } = fyDates(fy);

  const mapped = Object.keys(map.pl).length + Object.keys(map.bs).length;
  const overrides = map.overrides;
  const unmapped = [...(pack?.unmappedPl ?? []), ...(pack?.unmappedBs ?? [])];

  const tabLink = (k: string, label: string) => (
    <Link
      href={`/admin/zoho/itr?fy=${fy}&tab=${k}`}
      className={tab === k ? "btn small" : "btn small ghost"}
      style={{ textDecoration: "none" }}
    >
      {label}
    </Link>
  );

  const rentLedgers: LedgerRow[] = (pack?.pl ?? []).filter((r) => r.bucket === "HP");
  const foreignCandidates: LedgerRow[] = (pack?.bs ?? []).filter(
    (r) => r.bucket === "AL_BANK" || r.bucket === "AL_LIAB",
  );

  return (
    <main className="wrap">
      <AdminHero
        badge="Books desk"
        title="Return builder"
        subtitle="Zoho in, three outputs out: the financials, the computation of income, and Schedule AL."
        back={{ href: "/admin/zoho", label: "Zoho accounting hub" }}
      />

      {!connected && (
        <div className="card" style={{ borderColor: "#EF4444" }}>
          <p><strong>Zoho is not connected.</strong> Connect it on the accounting hub first — this page reads the profit and loss and the balance sheet straight from the books.</p>
        </div>
      )}

      <div className="card">
        <form action={buildYearAction} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ margin: 0 }}>Financial year</label>
          <select name="fy" defaultValue={fy} style={{ marginBottom: 0, width: 130 }}>
            {FYS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <span className="muted" style={{ fontSize: ".84rem" }}>{from} to {to}</span>
          <SubmitButton className="btn" savedLabel="✓ Built">📥 Read the books and build</SubmitButton>
          {builtAt && (
            <span className="muted" style={{ fontSize: ".8rem" }}>
              last built {new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).format(new Date(builtAt))}
            </span>
          )}
        </form>
        <p className="muted" style={{ fontSize: ".8rem", marginTop: 8, marginBottom: 0 }}>
          {mapped} ledgers have a destination{overrides > 0 ? `, ${overrides} of them changed here` : " — the suggested mapping, reconciled against the audited 2025-26 statements"}. Nothing is ever dropped without saying so: anything Zoho reports that has not been given one is listed in red.
        </p>
      </div>

      {pack && unmapped.length > 0 && (
        <div className="card" style={{ borderColor: "#EF4444" }}>
          <h3 style={{ marginTop: 0 }}>⚠ {unmapped.length} ledger{unmapped.length === 1 ? "" : "s"} with nowhere to go</h3>
          <p className="muted" style={{ fontSize: ".85rem" }}>
            These carry a balance in {fy} and are in none of the three outputs. Give each one a destination on the Mapping tab — this is exactly how ₹73 lakh of exchange difference and ₹1.96 crore of assets went missing last year.
          </p>
          <ul style={{ fontSize: ".88rem" }}>{unmapped.map((l) => <li key={l}>{l}</li>)}</ul>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, margin: "16px 0", flexWrap: "wrap" }}>
        {tabLink("outputs", "① Financials")}
        {tabLink("computation", "② Computation")}
        {tabLink("al", "③ Schedule AL")}
        {tabLink("mapping", "Mapping")}
        {tabLink("inputs", "Year figures")}
        {pack && (
          <Link href={`/admin/zoho/itr/export?fy=${fy}`} className="btn small ghost" style={{ textDecoration: "none" }}>
            ⬇ Download all three as Excel
          </Link>
        )}
      </div>

      {!pack && (
        <div className="card">
          <p>Nothing built for {fy} yet. Press <strong>Read the books and build</strong> above.</p>
        </div>
      )}

      {/* ---------------------------------------------------- ① financials */}
      {pack && tab === "outputs" && (
        <>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Statement of profit and loss — year ended {to.split("-").reverse().join("-")}</h3>
            <table className="table"><tbody>
              <Row label="Revenue from operations" value={pack.business.revenue} bold />
              <Row label="Other income" value={pack.business.otherIncome} bold />
              <Row label="Total income" value={pack.business.totalIncome} bold />
              <Row label="Cost of goods sold" value={pack.business.cogs} indent />
              <Row label="Employee benefits expense" value={pack.business.employee} indent />
              <Row label="Finance costs" value={pack.business.finance} indent />
              <Row label="Depreciation and amortisation" value={pack.business.depreciation} indent />
              <Row label="Other expenses" value={pack.business.otherExpenses} indent />
              <Row label="Total expenses" value={pack.business.totalExpenses} bold />
              <Row label="Profit before tax" value={pack.business.profit} bold />
            </tbody></table>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Balance sheet as at {to.split("-").reverse().join("-")}</h3>
            <table className="table"><tbody>
              <Row label="ASSETS" value={null} bold />
              {pack.business.assets.map((a) => <Row key={a.label} label={a.label} value={a.amount} indent />)}
              <Row label="Total assets" value={pack.business.totalAssets} bold />
              <Row label="LIABILITIES" value={null} bold />
              {pack.business.liabilities.map((a) => <Row key={a.label} label={a.label} value={a.amount} indent />)}
              <Row label="Total liabilities" value={pack.business.totalLiabilities} bold />
              <Row label="OWNER'S CAPITAL ACCOUNT" value={null} bold />
              <Row label="Opening balance" value={inputs.openingCapital} indent />
              <Row label="Capital introduced" value={inputs.capitalIntroduced} indent />
              <Row label="Profit for the year" value={pack.business.profit} indent />
              <Row label="Less: drawings (balancing figure)" value={-pack.business.drawings} indent />
              <Row label="Closing capital" value={pack.business.closingCapital} bold />
            </tbody></table>
            {inputs.openingCapital === 0 && (
              <p className="muted" style={{ fontSize: ".82rem" }}>
                Opening capital is still zero, so drawings above is not yet meaningful. Set it on the <strong>Year figures</strong> tab.
              </p>
            )}
          </div>
        </>
      )}

      {/* -------------------------------------------------- ② computation */}
      {pack && tab === "computation" && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Computation of total income — A.Y. {Number(fy.slice(0, 4)) + 1}-{String(Number(fy.slice(0, 4)) + 2).slice(2)}</h3>
          <table className="table"><tbody>
            <Row label="1  Income from house property" value={pack.computation.housePropertyTotal} bold />
            {pack.computation.houseProperty.map((h) => (
              <Row key={h.property} label={`${h.property} — annual value ${Math.round(h.annualValue).toLocaleString("en-IN")}, share ${h.share}%, less 30%`} value={h.income} indent />
            ))}
            <Row label="2  Profits and gains of business or profession" value={pack.computation.businessIncome} bold />
            <Row label="3  Speculation business (carried forward, not set off)" value={pack.computation.speculation} bold />
            <Row label="4  Capital gains" value={pack.computation.capitalGains.taxable} bold />
            <Row label="Gross gain per the books" value={pack.computation.capitalGains.gross} indent />
            <Row label="Less: brought-forward loss set off" value={-pack.computation.capitalGains.setOff} indent />
            <Row label="Loss still carried forward" value={pack.computation.capitalGains.carriedForward} indent />
            <Row label="5  Income from other sources" value={pack.computation.otherSourcesTotal} bold />
            {pack.computation.otherSources.map((o) => <Row key={o.label} label={o.label} value={o.amount} indent />)}
            <Row label="Gross total income" value={pack.computation.grossTotalIncome} bold />
            <Row label="Total income (rounded u/s 288A)" value={pack.computation.totalIncome} bold />
            <Row label="Tax on total income" value={pack.computation.tax} indent />
            <Row label="Surcharge" value={pack.computation.surcharge} indent />
            <Row label="Health and education cess at 4%" value={pack.computation.cess} indent />
            <Row label="Total tax and cess" value={pack.computation.totalTax} bold />
          </tbody></table>
          <p className="muted" style={{ fontSize: ".82rem" }}>
            New regime under s.115BAC. Interest under s.234A, B and C is not computed here — it follows from the figure above and belongs in the accountant&apos;s own software. Advance tax and TDS are in the books; deduct them from the total tax above.
          </p>
        </div>
      )}

      {/* -------------------------------------------------- ③ Schedule AL */}
      {pack && tab === "al" && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Schedule AL — assets and liabilities at {to.split("-").reverse().join("-")}</h3>
          <p className="muted" style={{ fontSize: ".84rem" }}>
            Everything he holds that is not in the business balance sheet above. A ledger cannot be in both — that is the point of the mapping.
          </p>
          {pack.scheduleAl.map((cat) => (
            <div key={cat.category} style={{ marginBottom: 14 }}>
              <h4 style={{ margin: "10px 0 4px" }}>{cat.category}</h4>
              <table className="table"><tbody>
                {cat.rows.map((r) => (
                  <tr key={r.ledger}>
                    <td style={{ paddingLeft: 22 }}>
                      {r.ledger}
                      {r.restated && (
                        <span className="muted" style={{ fontSize: ".76rem" }}>
                          {" "}— {r.foreign?.toLocaleString("en-US", { minimumFractionDigits: 2 })} foreign currency at ₹{inputs.closingUsdRate}
                        </span>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}><Money n={r.amount} width={130} /></td>
                  </tr>
                ))}
                <tr><td style={{ fontWeight: 600 }}>Total</td>
                  <td style={{ textAlign: "right", fontWeight: 600 }}><Money n={cat.total} width={130} /></td></tr>
              </tbody></table>
            </div>
          ))}
        </div>
      )}

      {/* ------------------------------------------------------- mapping */}
      {pack && tab === "mapping" && (
        <>
          <div className="card">
            <form action={restoreSuggestedMapAction}>
              <p style={{ marginTop: 0 }}>
                Every ledger Zoho reports, and where it lands. Change one and the financials, the computation and Schedule AL all move together.
              </p>
              <SubmitButton className="btn small ghost" savedLabel="✓ Restored">↺ Undo every change and go back to the suggested mapping</SubmitButton>
            </form>
          </div>
          {([
            ["Profit and loss", pack.pl, "pl", PL_BUCKETS] as const,
            ["Balance sheet", pack.bs, "bs", BS_BUCKETS] as const,
          ]).map(([title, rows, kind, buckets]) => (
            <div className="card" key={kind}>
              <h3 style={{ marginTop: 0 }}>{title}</h3>
              <table className="table">
                <thead><tr><th>Ledger</th><th style={{ textAlign: "right" }}>Amount</th><th>Goes to</th></tr></thead>
                <tbody>
                  {rows
                    .filter((r) => Math.abs(kind === "pl" ? signed(r) : bsAmount(r)) >= 0.5)
                    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
                    .map((r) => (
                      <tr key={r.ledger} style={!r.bucket ? { background: "#FEF2F2" } : undefined}>
                        <td>{r.ledger}</td>
                        <td style={{ textAlign: "right" }}>
                          <Money n={kind === "pl" ? signed(r) : bsAmount(r)} width={120} />
                        </td>
                        <td>
                          <form action={setBucketAction} style={{ display: "flex", gap: 6 }}>
                            <input type="hidden" name="ledger" value={r.ledger} />
                            <input type="hidden" name="kind" value={kind} />
                            <select name="bucket" defaultValue={r.bucket ?? ""} style={{ marginBottom: 0, fontSize: ".8rem", minWidth: 250 }}>
                              <option value="" disabled>— not decided —</option>
                              {buckets.map((b) => (
                                <option key={b.key} value={b.key}>{b.group} · {b.label}</option>
                              ))}
                            </select>
                            <SubmitButton className="btn small ghost" savedLabel="✓">Set</SubmitButton>
                          </form>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}

      {/* -------------------------------------------------- year figures */}
      {tab === "inputs" && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>The figures that are not in Zoho</h3>
          <p className="muted" style={{ fontSize: ".85rem" }}>
            A handful of things the books cannot know: what the capital account opened at, what depreciation the income-tax chart allows as against the books, what losses are brought forward, and the closing exchange rate. Told once a year.
          </p>
          <form action={saveInputsAction}>
            <input type="hidden" name="fy" value={fy} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 12 }}>
              {([
                ["openingCapital", "Owner's capital at the start of the year", inputs.openingCapital],
                ["capitalIntroduced", "Capital introduced during the year", inputs.capitalIntroduced],
                ["auditFeeProvision", "Audit fees payable (provision)", inputs.auditFeeProvision],
                ["depreciationPerItChart", "Depreciation per the income-tax chart u/s 32", inputs.depreciationPerItChart],
                ["broughtForwardStcl", "Short-term capital loss brought forward", inputs.broughtForwardStcl],
                ["broughtForwardLtcl", "Long-term capital loss brought forward", inputs.broughtForwardLtcl],
                ["closingUsdRate", "Closing exchange rate (SBI TT buy on the last day)", inputs.closingUsdRate],
              ] as const).map(([name, label, val]) => (
                <label key={name} style={{ display: "block", fontSize: ".85rem" }}>
                  {label}
                  <input name={name} defaultValue={val || ""} inputMode="decimal" style={{ marginBottom: 0 }} />
                </label>
              ))}
            </div>

            {rentLedgers.length > 0 && (
              <>
                <h4 style={{ marginBottom: 4 }}>Let-out property</h4>
                <p className="muted" style={{ fontSize: ".8rem", marginTop: 0 }}>
                  Where the books hold only his share of a co-owned property, give the full annual value here. Municipal tax comes off the whole property and the share is taken after that, which is the order s.23 and s.24 require.
                </p>
                <table className="table">
                  <thead><tr><th>Rent ledger</th><th>Full annual value</th><th>Municipal tax paid</th><th>Share held %</th></tr></thead>
                  <tbody>
                    {rentLedgers.map((r) => (
                      <tr key={r.ledger}>
                        <td>{r.ledger}<br /><span className="muted" style={{ fontSize: ".76rem" }}>books show {Math.round(r.amount).toLocaleString("en-IN")}</span></td>
                        <td><input name={`hpGross:${r.ledger}`} defaultValue={inputs.hpGrossUp[r.ledger] || ""} placeholder="same as books" inputMode="decimal" style={{ marginBottom: 0, width: 140 }} /></td>
                        <td><input name={`hpTax:${r.ledger}`} defaultValue={inputs.hpMunicipalTax[r.ledger] || ""} placeholder="0" inputMode="decimal" style={{ marginBottom: 0, width: 120 }} /></td>
                        <td><input name={`hpShare:${r.ledger}`} defaultValue={inputs.hpOwnershipShare[r.ledger] || ""} placeholder="100" inputMode="decimal" style={{ marginBottom: 0, width: 80 }} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {foreignCandidates.length > 0 && (
              <>
                <h4 style={{ marginBottom: 4 }}>Foreign-currency balances at the year end</h4>
                <p className="muted" style={{ fontSize: ".8rem", marginTop: 0 }}>
                  Give the balance in its own currency and Schedule AL restates it at the closing rate above, instead of carrying the rupee figure the books happen to hold. Leave blank to use the books.
                </p>
                <table className="table">
                  <thead><tr><th>Account</th><th style={{ textAlign: "right" }}>Rupees per the books</th><th>Balance in foreign currency</th></tr></thead>
                  <tbody>
                    {foreignCandidates.map((r) => (
                      <tr key={r.ledger}>
                        <td>{r.ledger}</td>
                        <td style={{ textAlign: "right" }}><Money n={bsAmount(r)} width={120} /></td>
                        <td><input name={`usd:${r.ledger}`} defaultValue={inputs.usdBalances[r.ledger] ?? ""} placeholder="—" inputMode="decimal" style={{ marginBottom: 0, width: 140 }} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            <label style={{ display: "block", fontSize: ".85rem", marginTop: 10 }}>
              Notes for the file
              <textarea name="notes" defaultValue={inputs.notes} rows={3} style={{ marginBottom: 0 }} />
            </label>
            <SubmitButton className="btn" savedLabel="✓ Saved and rebuilt">💾 Save and rebuild</SubmitButton>
          </form>
        </div>
      )}
    </main>
  );
}
