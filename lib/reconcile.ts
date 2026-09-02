// TWO-WAY BANK RECONCILIATION — the arithmetic, with nothing else attached.
//
// His question on 1 September 2026: "why don't you simply reconcile statements
// with Zoho books with same bank and find missing entries and suggest entries".
//
// The continuity check answers "something is missing" and cannot say what,
// because it only compares one statement's opening balance with the previous
// one's closing. This compares the LINES. Everything below is pure — no
// database, no Zoho — so the pairing rules can be proved in a test:
//
//   · a statement line and a Zoho entry agree when the date, the amount and
//     the direction agree
//   · a Zoho entry can only be claimed ONCE, so two identical payments on one
//     day need two entries in Zoho before both count as agreed
//   · what is left over on each side is the finding, and which side it is left
//     on is what tells you what to do about it

export type Side = "in" | "out";
// lineId travels through the pairing untouched so a finding can be acted on
// where it is found — the reconcile panel posts the entry from the row itself.
export type StatementSide = { date: string; narration: string; amount: number; dir: Side; lineStatus?: string; lineId?: string };
export type ZohoSide = { date: string; amount: number; dir: Side; type: string; note: string };

export type ReconLine = {
  date: string; narration: string; amount: number; dir: Side;
  zohoType?: string; zohoNote?: string; lineStatus?: string; lineId?: string;
};

export type Pairing = {
  matched: number;
  statementOnly: ReconLine[];
  zohoOnly: ReconLine[];
  statementTotalIn: number; statementTotalOut: number;
  zohoTotalIn: number; zohoTotalOut: number;
};

/** The key a statement line and a Zoho entry have to share to be the same money. */
export const matchKey = (date: string, amount: number, dir: Side) =>
  `${date}|${amount.toFixed(2)}|${dir}`;

export function pairLines(statement: StatementSide[], zoho: ZohoSide[]): Pairing {
  const out: Pairing = {
    matched: 0, statementOnly: [], zohoOnly: [],
    statementTotalIn: 0, statementTotalOut: 0, zohoTotalIn: 0, zohoTotalOut: 0,
  };

  const pool = new Map<string, ZohoSide[]>();
  for (const z of zoho) {
    if (!z.amount) continue;
    const k = matchKey(z.date, z.amount, z.dir);
    (pool.get(k) ?? pool.set(k, []).get(k)!).push(z);
    if (z.dir === "in") out.zohoTotalIn += z.amount; else out.zohoTotalOut += z.amount;
  }

  for (const l of statement) {
    if (!l.amount) continue;
    if (l.dir === "in") out.statementTotalIn += l.amount; else out.statementTotalOut += l.amount;
    const hit = pool.get(matchKey(l.date, l.amount, l.dir));
    if (hit && hit.length) {
      hit.shift();
      out.matched++;
    } else {
      out.statementOnly.push({ date: l.date, narration: l.narration, amount: l.amount, dir: l.dir, lineStatus: l.lineStatus, lineId: l.lineId });
    }
  }

  for (const left of pool.values()) {
    for (const z of left) {
      out.zohoOnly.push({ date: z.date, narration: z.note, amount: z.amount, dir: z.dir, zohoType: z.type, zohoNote: z.note });
    }
  }

  out.statementOnly.sort((a, b) => a.date.localeCompare(b.date));
  out.zohoOnly.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}
