import { AsyncLocalStorage } from "node:async_hooks";

// NOTHING REACHES ZOHO WITHOUT THE FOUNDER SAYING SO.
//
// Not a posting, not a date, not an amount, not a vendor, not a TDS figure.
// His rule, and it is right: the books are his, and a system that can quietly
// change them is a system he has to audit instead of trust.
//
// This is deliberately built as a CHOKEPOINT rather than a habit. Both Zoho
// gateways call assertZohoWriteAllowed() before any method that is not a GET,
// and the only thing that opens the gate is running inside releaseApproval() —
// which needs a row he personally approved in the portal. A new write added
// anywhere in the codebase is therefore blocked by default: forgetting to ask
// fails closed, never open.
//
// Reads stay free. Looking at the books changes nothing.

const release = new AsyncLocalStorage<{ approvalId: string }>();

/** Run fn with the gate open, for one approval he has released. */
export function withFounderApproval<T>(approvalId: string, fn: () => Promise<T>): Promise<T> {
  return release.run({ approvalId }, fn);
}

/** The approval this write belongs to, for the audit trail. */
export function currentApprovalId(): string | null {
  return release.getStore()?.approvalId ?? null;
}

export class NeedsFounderApproval extends Error {
  constructor(public readonly attempted: string) {
    super(
      `Blocked: "${attempted}" would change the books in Zoho, and nothing goes to Zoho without the founder's approval. ` +
      `Queue it in the portal instead — he approves it there, and it posts from that.`,
    );
    this.name = "NeedsFounderApproval";
  }
}

export function assertZohoWriteAllowed(method: string | undefined, path: string): void {
  const m = (method ?? "GET").toUpperCase();
  if (m === "GET") return;                    // reading the books changes nothing
  if (release.getStore()) return;             // he approved this one
  throw new NeedsFounderApproval(`${m} ${path}`);
}
