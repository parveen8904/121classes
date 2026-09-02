import { assertArea, currentStaff } from "@/lib/adminAccess";
import { zohoConfigured } from "@/lib/zohoApi";
import { formatINR } from "@/lib/pricing";
import { rule115Rate, ttBuyRate } from "@/lib/forexRates";
import { fySnapshot, indiaAdvanceTax, usEstimatedTax, taxAssumptions } from "@/lib/taxEngine";
import SubmitButton from "@/app/components/SubmitButton";
import DeskShell from "../_shell";
import { saveTaxAssumptionsAction } from "../actions";

// TAX WORKSHEETS AND THE RULE 115 RATES.
//
// The worksheets are the founder's alone; the rates belong beside them, because
// every conversion on this desk goes through them.

export const dynamic = "force-dynamic";

export default async function TaxPage(props: { searchParams: Promise<{ scan?: string }> }) {
  await assertArea("zoho");
  const sp = await props.searchParams;
  const hubConnected = await zohoConfigured();
  const staff = await currentStaff();
  const isFounder = staff?.role === "admin";

  let taxData: { snap: Awaited<ReturnType<typeof fySnapshot>>; india: ReturnType<typeof indiaAdvanceTax>; us: ReturnType<typeof usEstimatedTax>; assume: Awaited<ReturnType<typeof taxAssumptions>> } | null = null;
  if (isFounder && hubConnected) {
    try {
      const assume = await taxAssumptions();
      const snap = await fySnapshot();
      taxData = { snap, india: indiaAdvanceTax(snap, assume.effRatePct), us: usEstimatedTax(assume.usPriorYearTaxUsd), assume };
    } catch { /* the worksheet hides on a hiccup rather than half-drawing */ }
  }

  // The rate that applies today, and the five month-ends behind it.
  let r115: { rate: number; rateDate: string; keyDate: string } | null = null;
  if (hubConnected) {
    try {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
      r115 = await rule115Rate(today, "USD");
    } catch { /* the card simply hides on a source hiccup */ }
  }
  const monthEnds: { keyDate: string; rate: number | null; rateDate: string | null }[] = [];
  if (hubConnected) {
    const now = new Date();
    for (let i = 0; i < 5; i++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 0));
      const key = d.toISOString().slice(0, 10);
      try {
        const r = await ttBuyRate(key, "USD");
        monthEnds.push({ keyDate: key, rate: r?.rate ?? null, rateDate: r?.rateDate ?? null });
      } catch { monthEnds.push({ keyDate: key, rate: null, rateDate: null }); }
    }
  }

  return (
    <DeskShell
      badge="🧾 Tax"
      title="Tax worksheets"
      subtitle="The India advance-tax ladder from the live books, the US 1040-ES safe-harbour calendar, and the Rule 115 rates every conversion here goes through."
      current="/admin/zoho/tax"
      message={sp.scan}
    >
      {!isFounder ? (
        <p className="muted" style={{ marginTop: 16 }}>The worksheets are the founder&apos;s own. The Rule 115 rates below are for everybody.</p>
      ) : !taxData ? (
        <p className="muted" style={{ marginTop: 16 }}>The worksheet could not be built just now — it reads the live books, so it hides rather than half-drawing.</p>
      ) : (
        <>

  <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))" }}>
    <div className="card">
      <strong>🇮🇳 Advance tax — FY 2026-27 (A.Y. 2027-28)</strong>
      <div style={{ fontSize: ".84rem", lineHeight: 1.9, marginTop: 8 }}>
        <div>FY-to-date profit (live from Zoho): <strong>{formatINR(taxData.snap.pbt)}</strong> <span className="muted">({taxData.snap.monthsElapsed} months: income {formatINR(taxData.snap.income)} − expenses {formatINR(taxData.snap.expenses)})</span></div>
        <div>Annualised: <strong>{formatINR(taxData.india.annualisedPbt)}</strong> × {taxData.india.effRate}% = est. tax <strong>{formatINR(taxData.india.estTax)}</strong></div>
        <div>Less TDS suffered: {formatINR(taxData.india.tds)} · advance paid: {formatINR(taxData.india.paidSoFar)}</div>
        <div style={{ marginTop: 6 }}>
          {taxData.india.instalments.map((i) => (
            <span key={i.due} style={{ display: "inline-block", background: "var(--bg-soft)", borderRadius: 6, padding: "2px 8px", margin: "2px 6px 2px 0", fontSize: ".78rem" }}>
              {i.due.slice(5)} → {i.cumPct}% = {formatINR(i.cumRequired)}
            </span>
          ))}
        </div>
        <div style={{ marginTop: 6, fontWeight: 800 }}>
          Suggested by {taxData.india.nextDue}: {formatINR(taxData.india.nextRequired)}
        </div>
        <p className="muted" style={{ fontSize: ".74rem", margin: "6px 0 0" }}>A projection for your judgment — capital gains join the ladder in the instalment after they arise.</p>
      </div>
    </div>

    <div className="card">
      <strong>🇺🇸 US estimated tax (1040-ES) — safe harbour</strong>
      <div style={{ fontSize: ".84rem", lineHeight: 1.9, marginTop: 8 }}>
        {taxData.assume.usPriorYearTaxUsd > 0 ? (
          <>
            <div>Prior-year total tax: <strong>${taxData.us.priorYearTaxUsd.toLocaleString()}</strong> × 110% = <strong>${taxData.us.safeHarbourUsd.toLocaleString()}</strong></div>
            <div>Per quarter: <strong>${Math.round(taxData.us.quarterlyUsd).toLocaleString()}</strong></div>
            <div style={{ marginTop: 6 }}>
              {taxData.us.quarters.map((q) => (
                <span key={q.due} style={{ display: "inline-block", background: "var(--bg-soft)", borderRadius: 6, padding: "2px 8px", margin: "2px 6px 2px 0", fontSize: ".78rem" }}>{q.label}: {q.due}</span>
              ))}
            </div>
            <div style={{ marginTop: 6, fontWeight: 800 }}>Next due: {taxData.us.nextDue}</div>
            <p className="muted" style={{ fontSize: ".74rem", margin: "6px 0 0" }}>Paying 110% of last year&apos;s tax in equal quarters avoids penalty regardless of this year&apos;s income. Your CPA files; this is the calendar and the arithmetic.</p>
          </>
        ) : (
          <p className="muted" style={{ fontSize: ".82rem" }}>Enter last year&apos;s total US tax below and the safe-harbour schedule appears.</p>
        )}
      </div>
    </div>
  </div>

  <form action={saveTaxAssumptionsAction} className="card" style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
    <div>
      <label style={{ fontSize: ".75rem" }}>Assumed effective Indian tax rate (%)</label>
      <input name="eff_rate" type="number" step="0.1" min="1" max="60" defaultValue={taxData.assume.effRatePct} style={{ marginBottom: 0, width: 130 }} />
    </div>
    <div>
      <label style={{ fontSize: ".75rem" }}>Prior-year US total tax (USD)</label>
      <input name="us_py_tax" type="number" step="1" min="0" defaultValue={taxData.assume.usPriorYearTaxUsd || ""} style={{ marginBottom: 0, width: 150 }} />
    </div>
    <SubmitButton className="btn small" savedLabel="✓ Saved">💾 Save assumptions</SubmitButton>
    <span className="muted" style={{ fontSize: ".76rem" }}>Only you see this section.</span>
  </form>


        </>
      )}

  <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
    <strong>💱 Rule 115 — SBI TT buying rates</strong>
    {r115 && <span style={{ fontSize: "1.1rem", fontWeight: 800 }}>this month: ₹{r115.rate.toFixed(2)}/USD</span>}
    <span className="muted" style={{ fontSize: ".78rem" }}>source: officialforexrates.com (the designated authority)</span>
  </div>
  {monthEnds.length > 0 && (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
      {monthEnds.map((m) => (
        <div key={m.keyDate} style={{ background: "var(--bg-soft)", borderRadius: 8, padding: "6px 12px", fontSize: ".82rem" }}>
          <div className="muted" style={{ fontSize: ".72rem" }}>{m.keyDate}</div>
          <strong>{m.rate ? `₹${m.rate.toFixed(2)}` : "—"}</strong>
          {m.rate && m.rateDate !== m.keyDate && <span className="muted" style={{ fontSize: ".7rem" }}> ({m.rateDate})</span>}
        </div>
      ))}
    </div>
  )}
  {/* The rule itself, said once, plainly — beside the numbers it governs. */}
  <p className="muted" style={{ fontSize: ".8rem", lineHeight: 1.7, margin: "10px 0 0" }}>
    <strong>Rule 115, Income-tax Rules 1962 — in short:</strong> foreign income is converted to rupees at the
    <strong> SBI telegraphic-transfer BUYING rate</strong> on a specified date — for interest, dividends and
    most income: the <strong>last day of the month before</strong> the month the income arose; for capital
    gains: the last day of the month before the <strong>transfer</strong>; for salary: before the month it was
    due. If SBI published nothing that day (holiday), the nearest earlier published rate applies. Every
    conversion this desk makes stores its dollar amount, the rate used, the rate&apos;s date and this rule —
    so any figure can be traced years later.
  </p>
    </DeskShell>
  );
}
