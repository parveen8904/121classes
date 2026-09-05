import Link from "next/link";
import AdminHero from "../../../_components/AdminHero";
import { assertArea } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import SubmitButton from "@/app/components/SubmitButton";
import { compute1040, INPUT_KEYS, BRACKETS_2025_MFJ, type Us1040Figures } from "@/lib/us1040";
import { setUs1040Input, seedUs1040Year } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "US 1040 — Zoho — Admin" };

// FORM 1040, ON THE SCREEN.
//
// "i want my us 1040 page. where is that." — 5 September 2026. There was only
// the Excel of the income side; the return itself lived in a workbook on his
// laptop. This is the same computation, and it is checked against that workbook
// line for line in tests/us1040.test.ts — total income, AGI, taxable income,
// the seven bands, the credit, self-employment tax, additional Medicare, and
// the $5,511.49 overpaid.
//
// The income figures are typed here rather than pulled straight from Zoho on
// purpose. Four of the six need a decision no ledger can make: which of the
// interest is US-source, what the 1099-Bs say against what the rupee scrip
// ledgers say, how much depreciation the rental takes. The Excel at
// /admin/zoho/tax/us gives the book figures to copy in, and the entry stays a
// deliberate act.

const usd = (n: number) =>
  `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Row({ label, value, bold, indent, muted }: {
  label: string; value: number | null; bold?: boolean; indent?: boolean; muted?: boolean;
}) {
  return (
    <tr style={{ borderTop: "1px solid rgba(0,0,0,.06)" }}>
      <td style={{ padding: "5px 10px", paddingLeft: indent ? 30 : 10, fontWeight: bold ? 700 : 400, color: muted ? "var(--muted)" : undefined }}>{label}</td>
      <td style={{ padding: "5px 10px", textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: bold ? 700 : 400 }}>
        {value === null ? "" : usd(value)}
      </td>
    </tr>
  );
}

export default async function Us1040Page({ searchParams }: {
  searchParams: Promise<{ year?: string; err?: string; saved?: string; seeded?: string }>;
}) {
  await assertArea("zoho");
  const sp = await searchParams;
  const thisYear = new Date().getUTCFullYear();
  const year = Math.min(2100, Math.max(2000, Math.round(Number(sp.year) || thisYear - 1)));

  const svc = createServiceClient();
  const { data: rows } = await svc.from("us1040_inputs").select("key, value, note").eq("year", year);
  const held = new Map((rows ?? []).map((r) => [String(r.key), Number(r.value)]));
  const notes = new Map((rows ?? []).map((r) => [String(r.key), (r.note as string | null) ?? null]));

  const f = Object.fromEntries(INPUT_KEYS.map((k) => [k.key, held.get(k.key) ?? 0])) as Us1040Figures;
  const r = compute1040(f, BRACKETS_2025_MFJ);
  const started = (rows ?? []).length > 0;
  const years = [thisYear, thisYear - 1, thisYear - 2, thisYear - 3];

  return (
    <main className="wrap">
      <AdminHero
        badge="Books desk"
        title={`US Form 1040 — ${year}`}
        subtitle="The same computation as the workbook, checked against it line for line. Married filing jointly."
        back={{ href: "/admin/zoho/tax", label: "Tax" }}
      />

      {sp.err && <p className="notice err" style={{ marginTop: 12 }}>{sp.err}</p>}
      {sp.seeded && <p className="notice ok" style={{ marginTop: 12 }}>✅ {year} opened with the statutory figures. Check them against that year&apos;s Rev. Proc.</p>}

      <div className="card" style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: ".8rem" }}>Year</span>
        {years.map((y) => (
          <Link key={y} href={`/admin/zoho/tax/us1040?year=${y}`}
                className={y === year ? "btn small" : "btn small ghost"} style={{ textDecoration: "none" }}>{y}</Link>
        ))}
        <span style={{ flex: 1 }} />
        <Link className="btn small secondary" style={{ textDecoration: "none" }}
              href={`/admin/zoho/tax/us?from=${year}-01-01&to=${year}-12-31`}>
          ⬇ The book figures for {year} (Excel)
        </Link>
      </div>

      {!started && (
        <div className="card" style={{ marginTop: 10, borderLeft: "3px solid #b45309" }}>
          <p style={{ margin: 0, lineHeight: 1.7 }}>
            <strong>Nothing is set for {year}.</strong> Every line below is zero, and a zero return is not an
            answer — it is an empty sheet that looks like one. Open the year with the statutory figures, then
            fill in the income from the Excel above and the documents.
          </p>
          <form action={seedUs1040Year} style={{ marginTop: 8 }}>
            <input type="hidden" name="year" value={year} />
            <SubmitButton className="btn small">Open {year} with the 2025 statute</SubmitButton>
          </form>
        </div>
      )}

      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(360px,1fr))", marginTop: 10 }}>
        {/* ─────────────────────────────────── the return itself */}
        <div className="card">
          <strong>Form 1040</strong>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".84rem", marginTop: 6 }}>
            <tbody>
              <Row label="INCOME" value={null} bold />
              <Row label="Taxable interest — 2b" value={f.interest} indent />
              <Row label="Ordinary dividends — 3b" value={f.dividends} indent />
              <Row label="Business income — Sch. C 8a" value={f.businessIncome} indent />
              <Row label="Capital gain — Sch. D 7" value={f.capitalGain} indent />
              <Row label="Rents and royalties — Sch. E 8" value={f.rentsRoyalties} indent />
              <Row label="Less: rental depreciation" value={f.rentalDepreciation} indent />
              <Row label="TOTAL INCOME — line 9" value={r.totalIncome} bold />

              <Row label="ADJUSTMENTS" value={null} bold />
              <Row label="Deductible half of self-employment tax" value={-r.deductibleHalfOfSeTax} indent />
              <Row label="Traditional IRA" value={f.traditionalIra} indent />
              <Row label="ADJUSTED GROSS INCOME — line 11" value={r.adjustedGrossIncome} bold />
              <Row label="Standard deduction — line 12" value={f.standardDeduction} indent />
              <Row label="Qualified business income — line 13" value={f.qbiDeduction} indent />
              <Row label="TAXABLE INCOME — line 15" value={r.taxableIncome} bold />

              <Row label="TAX AND CREDITS" value={null} bold />
              <Row label="Tax — line 16" value={r.tax} indent />
              <Row label="Foreign tax credit — Sch. 3 line 1" value={-Math.abs(f.foreignTaxCredit)} indent />
              <Row label="Tax after the credit" value={r.taxAfterCredit} bold />

              <Row label="OTHER TAXES — beyond the credit's reach" value={null} bold />
              <Row label="Self-employment tax — Sch. 2" value={r.selfEmploymentTax} indent />
              <Row label="Additional Medicare — Form 8959" value={r.additionalMedicare} indent />
              <Row label="Net investment income tax — Form 8960" value={f.netInvestmentIncomeTax} indent />
              <Row label="TOTAL TAX — line 24" value={r.totalTax} bold />

              <Row label="PAYMENTS" value={null} bold />
              <Row label="Estimated tax paid" value={f.estimatedTaxPaid} indent />
              <Row label="Credit applied from the prior year" value={f.creditAppliedFromPriorYear} indent />
              <Row label="Balance payment" value={f.balancePayment} indent />
              <Row label="TOTAL PAYMENTS — line 33" value={r.totalPayments} bold />
              <Row label={r.balance >= 0 ? "OVERPAID — line 34" : "YOU OWE — line 37"} value={Math.abs(r.balance)} bold />
            </tbody>
          </table>
        </div>

        {/* ─────────────────────────────────── the bands, so the tax is checkable */}
        <div className="card">
          <strong>How the tax on line 16 is made</strong>
          <p className="muted" style={{ fontSize: ".78rem", margin: "4px 0 6px", lineHeight: 1.6 }}>
            Qualified dividends come out of the slab base and are taxed at their own rate, so they are not
            taxed twice. 2025 married-filing-jointly bands, Rev. Proc. 2024-40.
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".8rem" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: ".72rem" }}>
                <th style={{ padding: "4px 8px" }}>Band</th>
                <th style={{ padding: "4px 8px", textAlign: "right" }}>In band</th>
                <th style={{ padding: "4px 8px", textAlign: "right" }}>Tax</th>
              </tr>
            </thead>
            <tbody>
              {r.bands.map((b) => (
                <tr key={b.label} style={{ borderTop: "1px solid rgba(0,0,0,.06)", opacity: b.inBand > 0 ? 1 : 0.45 }}>
                  <td style={{ padding: "4px 8px" }}>
                    {b.label} <span className="muted" style={{ fontSize: ".72rem" }}>
                      {usd(b.from)} → {b.to === null ? "no ceiling" : usd(b.to)}
                    </span>
                  </td>
                  <td style={{ padding: "4px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{usd(b.inBand)}</td>
                  <td style={{ padding: "4px 8px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{usd(b.tax)}</td>
                </tr>
              ))}
              <Row label="Tax on ordinary income" value={r.taxOnOrdinary} bold />
              <Row label={`Qualified dividends at ${Math.round((f.qualifiedDividendRate || 0) * 100)}%`} value={r.taxOnQualifiedDividends} indent />
              <Row label="TAX — line 16" value={r.tax} bold />
            </tbody>
          </table>

          <strong style={{ display: "block", marginTop: 14 }}>Self-employment tax</strong>
          <p className="muted" style={{ fontSize: ".78rem", margin: "4px 0 0", lineHeight: 1.6 }}>
            Net earnings are 92.35% of Schedule C — s.1402(a)(12), the employer-equivalent half is not itself
            earnings. Social security stops at {usd(f.socialSecurityWageBase)}; Medicare has no ceiling, and
            0.9% more applies above {usd(f.additionalMedicareThreshold)}.
          </p>
        </div>
      </div>

      {/* ─────────────────────────────────── the figures he sets */}
      <div className="card" style={{ marginTop: 10 }}>
        <strong>What you set</strong>
        <p className="muted" style={{ fontSize: ".78rem", margin: "4px 0 8px", lineHeight: 1.6 }}>
          Everything above computes from these. The income lines come off the Excel and the documents; the
          statutory ones change with the year.
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".82rem" }}>
          <tbody>
            {INPUT_KEYS.map((k) => (
              <tr key={k.key} style={{ borderTop: "1px solid rgba(0,0,0,.06)" }}>
                <td style={{ padding: "5px 8px" }}>
                  {k.label}
                  {k.statutory && <span className="badge" style={{ marginLeft: 6 }}>statute</span>}
                  <div className="muted" style={{ fontSize: ".72rem" }}>
                    {k.source}{notes.get(k.key) ? ` · ${notes.get(k.key)}` : ""}
                  </div>
                </td>
                <td style={{ padding: "5px 8px", width: 250 }}>
                  <form action={setUs1040Input} style={{ display: "flex", gap: 6, margin: 0 }}>
                    <input type="hidden" name="year" value={year} />
                    <input type="hidden" name="key" value={k.key} />
                    <input name="value" defaultValue={String(held.get(k.key) ?? "")}
                           placeholder="0"
                           style={{ marginBottom: 0, width: 150, fontSize: ".8rem", textAlign: "right", fontVariantNumeric: "tabular-nums" }} />
                    <SubmitButton className="btn small ghost" savedLabel="✓">Set</SubmitButton>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ fontSize: ".78rem", marginTop: 12, lineHeight: 1.7 }}>
        A projection for your judgment, not a filed return. It does not compute Form 1116 — the foreign tax
        credit is entered from it — and the capital gain must come from the 1099-Bs, not the rupee scrip
        ledgers: for 2025 those held $511,788 against roughly $55,000 the books implied.
      </p>
    </main>
  );
}
