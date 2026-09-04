// ONE PLACE THAT KNOWS HOW TO WRITE MONEY.
//
// The statements desk printed a ₹ in front of every figure, because rupees
// were the only currency it had ever been shown. His Citi Costco card is a USD
// account in Zoho, and its April statement came back reading "₹163.73" — the
// right number wearing the wrong sign, which is the kind of wrongness that
// survives a review because nothing about it looks broken.
//
// Indian grouping belongs to the rupee and to nothing else: 1,23,456.78 is
// correct for ₹ and wrong for $. So the locale follows the currency.

const SYMBOL: Record<string, string> = {
  INR: "₹", USD: "$", EUR: "€", GBP: "£", AED: "AED ", SGD: "S$", AUD: "A$", CAD: "C$", JPY: "¥",
};

/** The currencies offered in the picker — his own accounts first. */
export const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD", "JPY"];

export function currencySymbol(code?: string | null): string {
  const c = String(code ?? "INR").toUpperCase();
  return SYMBOL[c] ?? `${c} `;
}

/**
 * A figure with its own currency in front of it.
 *
 * `dp` defaults to whole units, which is how the queue has always shown a
 * rupee amount; pass 2 where the paise or cents matter.
 */
export function money(amount: number, code?: string | null, dp = 0): string {
  const c = String(code ?? "INR").toUpperCase();
  const n = Number(amount) || 0;
  const locale = c === "INR" ? "en-IN" : "en-US";
  return `${currencySymbol(c)}${n.toLocaleString(locale, { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}
