// WHAT "PAID" MEANS, TABLE BY TABLE.
//
// Three tables record a sale and none of them agrees on the word for a
// completed one:
//
//   orders        paid · created · failed · refunded
//   gift_orders   provisioned · created          ← a finished sale is "provisioned"
//   book_orders   paid · dispatched · delivered · cancelled   (a Postgres enum)
//
// So ticking "Paid" on the sales page quietly excluded every order ever placed
// through a supporter, because not one of them has ever had the status "paid" —
// a completed supporter sale is provisioned, which is a word about access being
// granted, not about money. The register showed the takings short and the
// download left the vendors out entirely.
//
// Rather than rename anything under a live business, the tick boxes are treated
// as the plain words they look like, and each table is asked in its own
// vocabulary. Anything the table has never heard of is dropped instead of sent,
// because a value outside an enum is not an empty result — it is an error, and
// PostgREST reports it in a field this code was not reading.

/** The words on the tick boxes. What a person means, not what a column holds. */
export const ORDER_STATES = ["paid", "created", "failed", "refunded"] as const;
export type OrderState = (typeof ORDER_STATES)[number];

const ORDERS: Record<OrderState, string[]> = {
  paid: ["paid"],
  created: ["created"],
  failed: ["failed"],
  refunded: ["refunded"],
};

const GIFTS: Record<OrderState, string[]> = {
  // A supporter sale that went through is "provisioned" — the student's access
  // was granted. That is this table's word for paid.
  paid: ["provisioned", "paid"],
  created: ["created"],
  failed: ["failed"],
  refunded: ["refunded"],
};

const BOOKS: Record<OrderState, string[]> = {
  // A book that has been posted was paid for first; excluding it from "paid"
  // would hide most of the book takings.
  paid: ["paid", "dispatched", "delivered"],
  created: [],
  failed: [],
  refunded: ["cancelled"],
};

const TABLES = { orders: ORDERS, gift_orders: GIFTS, book_orders: BOOKS };
export type OrderTable = keyof typeof TABLES;

/** Read the tick boxes off a URL, keeping only words we offer. */
export function chosenStates(raw: string | null | undefined): OrderState[] {
  return (raw ?? "")
    .split(",").map((x) => x.trim().toLowerCase())
    .filter((x): x is OrderState => (ORDER_STATES as readonly string[]).includes(x));
}

/**
 * The values to ask `table` for. Empty array = the person ticked nothing, so
 * everything is wanted and no filter should be applied at all.
 *
 * Careful: an empty array is also what you get when somebody ticks only
 * "created" and asks the book table, which has no such state — and there the
 * right answer is no book rows, not all of them. The caller is told the
 * difference by `chosen.length`.
 */
export function statusesFor(table: OrderTable, chosen: OrderState[]): string[] {
  const map = TABLES[table];
  return [...new Set(chosen.flatMap((c) => map[c]))];
}

/** Does this row's own status match what was ticked? For filtering in memory. */
export function matchesState(table: OrderTable, chosen: OrderState[], status: string | null | undefined): boolean {
  if (!chosen.length) return true;
  return statusesFor(table, chosen).includes(String(status ?? "").toLowerCase());
}
