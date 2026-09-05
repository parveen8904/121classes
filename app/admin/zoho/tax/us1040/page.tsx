import Link from "next/link";
import AdminHero from "../../../_components/AdminHero";
import { assertArea } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import SubmitButton from "@/app/components/SubmitButton";
import { compute1040, INPUT_KEYS, statuteFor, statutoryFigures, STATUTE_BY_YEAR, type Us1040Figures } from "@/lib/us1040";
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

  // THE YEAR'S OWN LAW, OR NONE AT ALL.
  //
  // "2026 us tax 1040 not working, similarly 2024 not working" — 5 September
  // 2026. Every year was computed on the 2025 brackets and the 2025 deduction,
  // and a 2024 heading over a 2025 return is worse than no return: it is wrong
  // in a way nothing on the page would show. A year whose statute is not held
  // is refused outright rather than borrowing the nearest one.
  const statute = statuteFor(year);
  const lawful = statutoryFigures(year) ?? {};
  // A figure he has set wins; otherwise the year's statute stands in, so
  // picking 2024 gives 2024's law with only the income left to fill.
  const f = Object.fromEntries(
    INPUT_KEYS.map((k) => [k.key, held.get(k.key) ?? (lawful as Record<string, number>)[k.key] ?? 0]),
  ) as Us1040Figures;
  const r = compute1040(f, statute?.brackets ?? []);
  // A SEEDED YEAR IS NOT A STARTED ONE.
  //
  // "It shows zero." — 5 September 2026. He had pressed "open with the statute",
  // which wrote the standard deduction and the bracket figures, and my banner
  // then went quiet because rows existed. What was on screen was a return with
  // −$31,500 of deduction against nothing at all: precisely the empty sheet
  // that looks like an answer, which the banner exists to prevent.
  //
  // Having any row is not the test. Having any INCOME is.
  const incomeKeys = ["interest", "dividends", "businessIncome", "capitalGain", "rentsRoyalties"] as const;
  const hasIncome = incomeKeys.some((k) => Number(held.get(k) ?? 0) !== 0);
  const started = hasIncome;
  const seededOnly = (rows ?? []).length > 0 && !hasIncome;
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

      {!statute && (
        <div className="card" style={{ marginTop: 10, borderLeft: "3px solid #b91c1c" }}>
          <p style={{ margin: 0, lineHeight: 1.7 }}>
            <strong>The 1040 does not hold the statute for {year}.</strong> The brackets, the standard
            deduction and the wage base change every year, and computing {year} on another year&apos;s law
            would produce a return that looks right and is not. Nothing is shown below until{" "}
            {year}&apos;s Revenue Procedure is added to <code>STATUTE_BY_YEAR</code>.
          </p>
          <p className="muted" style={{ margin: "6px 0 0", fontSize: ".78rem" }}>
            Held so far: {Object.keys(STATUTE_BY_YEAR).join(", ")}.
          </p>
        </div>
      )}

      {statute && !started && (
        <div className="card" style={{ marginTop: 10, borderLeft: "3px solid #b45309" }}>
          <p style={{ margin: 0, lineHeight: 1.7 }}>
            {seededOnly ? (
              <>
                <strong>{year} has the statute but no income.</strong> The deduction and the thresholds are
                set; every income line is still zero, so the return below is arithmetic on nothing. Fill in
                the income from the Excel above and from the 1099s — the figures you set are at the bottom
                of this page.
              </>
            ) : (
              <>
                <strong>Nothing is set for {year}.</strong> Every line below is zero, and a zero return is not
                an answer — it is an empty sheet that looks like one. Open the year with the statutory
                figures, then fill in the income from the Excel above and the documents.
              </>
            )}
          </p>
          {!seededOnly && (
            <form action={seedUs1040Year} style={{ marginTop: 8 }}>
              <input type="hidden" name="year" value={year} />
              <SubmitButton className="btn small">Write {year}&apos;s statute in — {statute?.citation}</SubmitButton>
            </form>
          )}
        </div>
      )}

      {statute && (<>
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
              <Row label="Foreign tax credit — Sch. 3 line 1" value={-r.foreignTaxCredit} indent />
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
            taxed twice. {year} married-filing-jointly bands, {statute?.citation}.
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

      {/* ─────────────────────────────────── Form 1116 */}
      <div className="card" style={{ marginTop: 10 }}>
        <strong>Form 1116 — the two baskets, the limit, and what is carried</strong>
        <p className="muted" style={{ fontSize: ".78rem", margin: "4px 0 8px", lineHeight: 1.6 }}>
          The credit shelters the US tax on foreign income and not a cent more. The ceiling is the tax ×
          foreign-source taxable income ÷ total taxable income, and s.904(d) applies it to each basket on its
          own — room going spare in one cannot rescue a shortfall in the other.
        </p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: ".82rem", minWidth: 640 }}>
            <thead>
              <tr style={{ textAlign: "right", color: "var(--muted)", fontSize: ".72rem" }}>
                <th style={{ padding: "4px 8px", textAlign: "left" }}>Basket</th>
                <th style={{ padding: "4px 8px" }}>Gross foreign</th>
                <th style={{ padding: "4px 8px" }}>Foreign taxable</th>
                <th style={{ padding: "4px 8px" }}>Limit</th>
                <th style={{ padding: "4px 8px" }}>Indian tax</th>
                <th style={{ padding: "4px 8px" }}>Credit</th>
                <th style={{ padding: "4px 8px" }}>Carried</th>
              </tr>
            </thead>
            <tbody>
              {r.f1116.baskets.map((b) => (
                <tr key={b.label} style={{ borderTop: "1px solid rgba(0,0,0,.06)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  <td style={{ padding: "5px 8px", textAlign: "left" }}>{b.label}</td>
                  <td style={{ padding: "5px 8px" }}>{usd(b.grossForeign)}</td>
                  <td style={{ padding: "5px 8px" }}>{usd(b.foreignTaxableIncome)}</td>
                  <td style={{ padding: "5px 8px" }}>{usd(b.limit)}</td>
                  <td style={{ padding: "5px 8px" }}>{usd(b.foreignTaxPaid)}</td>
                  <td style={{ padding: "5px 8px", fontWeight: 700 }}>{usd(b.creditAllowed)}</td>
                  <td style={{ padding: "5px 8px", color: b.carriedForward > 0 ? "#b45309" : undefined }}>{usd(b.carriedForward)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: "2px solid rgba(0,0,0,.2)", textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                <td style={{ padding: "5px 8px", textAlign: "left" }}>Total — Schedule 3 line 1</td>
                <td style={{ padding: "5px 8px" }} />
                <td style={{ padding: "5px 8px" }}>{usd(r.f1116.totalForeignTaxable)}</td>
                <td style={{ padding: "5px 8px" }}>{usd(r.f1116.totalLimit)}</td>
                <td style={{ padding: "5px 8px" }} />
                <td style={{ padding: "5px 8px" }}>{usd(r.f1116.totalCredit)}</td>
                <td style={{ padding: "5px 8px" }}>{usd(r.f1116.totalCarried)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {r.f1116.notes.map((n) => (
          <p key={n} className="muted" style={{ fontSize: ".78rem", margin: "6px 0 0", lineHeight: 1.6 }}>{n}</p>
        ))}
        <p className="muted" style={{ fontSize: ".74rem", margin: "6px 0 0", lineHeight: 1.6 }}>
          The deductible half of the self-employment tax comes off the GENERAL basket alone — it is definitely
          related to the practice. The standard deduction and the IRA are shared across the baskets in
          proportion to their gross income, which is what line 3a means.
        </p>
      </div>
      </>)}

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
        A projection for your judgment, not a filed return. The foreign tax credit above is computed from
        Form 1116, not typed. The capital gain must come from the 1099-Bs and not from the rupee scrip
        ledgers: for 2025 those held $511,788 against roughly $55,000 the books implied.
      </p>
    </main>
  );
}
