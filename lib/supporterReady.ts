// WHETHER A VENDOR MAY SELL YET — ASKED IN ONE PLACE.
//
// The rule: no order until the profile is complete, the shopfront is proved to
// be theirs, the terms are accepted, and the account is not on hold.
//
// It lives here rather than in the page or the action, because those two had
// already drifted apart once: the page let a vendor fill in a student's name,
// address and term, and only at the payment button did the server say no. Five
// minutes of somebody's evening spent on a form that could never have gone
// through. Both now ask this same function, so what the screen says and what
// the server does cannot disagree.
//
// Everything required here is required for a REASON, and the reason is on the
// line beside it. A rule a vendor cannot see the sense of is a rule they will
// ring the office about.

export type SupporterProfile = {
  full_name?: string | null;
  business_name?: string | null;
  phone?: string | null;
  email?: string | null;
  address_line1?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  supporter_site?: string | null;
  supporter_site_ok_at?: string | null;
  supporter_terms_at?: string | null;
  supporter_blocked_at?: string | null;
  supporter_block_reason?: string | null;
};

export type Missing = {
  /** What they must do, in their own words. */
  what: string;
  /** Why it is asked — never a rule without a reason. */
  why: string;
  /** Where to do it. */
  href: string;
};

export type Readiness =
  | { ready: true }
  | { ready: false; blocked: boolean; blockReason?: string; missing: Missing[] };

const has = (v: unknown) => String(v ?? "").trim().length > 0;

export function supporterReadiness(p: SupporterProfile | null | undefined): Readiness {
  if (!p) return { ready: false, blocked: false, missing: [{ what: "Sign in again", why: "We could not read your account.", href: "/login?next=/supporter/sell" }] };

  // ON HOLD OUTRANKS EVERYTHING. A complete profile does not unlock an account
  // that was stopped for breaking the agreement — that takes the penalty being
  // settled and a person releasing it.
  if (has(p.supporter_blocked_at)) {
    return {
      ready: false,
      blocked: true,
      blockReason: p.supporter_block_reason ?? undefined,
      missing: [{
        what: "Your account is on hold",
        why: "New orders are paused until this is settled. Everything else — your sign-in, your invoices, the students you have already sold to — is untouched.",
        href: "/supporter/terms",
      }],
    };
  }

  const missing: Missing[] = [];
  const profile = "/supporter/profile?next=/supporter/sell";

  if (!has(p.full_name) && !has(p.business_name)) {
    missing.push({ what: "Your name or business name", why: "It goes on every invoice you raise.", href: profile });
  }
  if (!has(p.email)) {
    missing.push({ what: "An email address", why: "Your invoices and order confirmations are sent there.", href: profile });
  }
  if (!has(p.phone)) {
    missing.push({ what: "A phone number", why: "When a student's parcel or access needs sorting out, we ring you, not them.", href: profile });
  }
  if (!has(p.address_line1) || !has(p.city) || !has(p.state) || !has(p.pincode)) {
    missing.push({
      what: "Your billing address, with the state",
      why: "The state decides whether your invoice carries CGST and SGST or IGST. Without it the tax on your own invoice is a guess.",
      href: profile,
    });
  }
  if (!has(p.supporter_site)) {
    missing.push({
      what: "The website you sell from",
      why: "The agreement is about what appears on your shopfront — the price honoured, and our courses not bundled with another teacher's. We cannot hold to that without knowing where it is.",
      href: profile,
    });
  } else if (!has(p.supporter_site_ok_at)) {
    missing.push({
      what: "Proof that the website is yours",
      why: "Publish the short code shown on your profile anywhere on the site and press Check. Only somebody who can publish to it could do that — which is what makes it proof.",
      href: profile,
    });
  }
  if (!has(p.supporter_terms_at)) {
    missing.push({
      what: "Accept how this works",
      why: "One page: how to place an order, and the three rules — never more than 5% off, never bundled with another faculty, one declared website. It takes a minute to read and is the basis of everything else.",
      href: "/supporter/terms?next=/supporter/sell",
    });
  }

  return missing.length === 0 ? { ready: true } : { ready: false, blocked: false, missing };
}

/** The columns this needs, so a caller cannot select half of them by accident. */
export const SUPPORTER_READY_COLUMNS =
  "full_name, business_name, phone, email, address_line1, city, state, pincode, " +
  "supporter_site, supporter_site_ok_at, supporter_terms_at, supporter_blocked_at, supporter_block_reason";
