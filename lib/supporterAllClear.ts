import { createServiceClient } from "@/lib/supabase/service";

// TELLING THE SELLERS WHERE THEY STAND.
//
// Ten sellers had their websites cleared on 18 August. Four of them had
// published our verification code correctly and been refused anyway — one of
// them pressed Check sixty-two times in an afternoon. Two were fined ₹5,000 and
// emailed an accusation over discounts that belonged to other teachers. None of
// them has been told any of this.
//
// The founder's instruction: tell them their site is good and they may order.
// The only difficulty is that it is not equally true of all ten, and a cheerful
// note that turns out to be wrong is worse than no note at all. So the letter is
// assembled from what is actually true of each account:
//
//   · everyone is told their site is cleared and that nothing stands against
//     them — no hold, no penalty;
//   · the two who were wrongly fined are told so plainly, and apologised to,
//     because they are owed that more than they are owed good news;
//   · those who can order are told to go ahead; those who still have the seller
//     terms to accept are told that, in one sentence, with the link;
//   · anyone with a finding still waiting for the office to read is left out
//     entirely. We do not write "all is well" to somebody we may have to write
//     to about a page next week.

const SITE = "https://caparveensharma.com";

/** What we know about one seller, and therefore what the letter has to say. */
export type SellerStanding = {
  id: string;
  name: string;
  email: string;
  site: string;
  canOrder: boolean;
  needsTerms: boolean;
  needsDetails: boolean;
  wronglyFined: boolean;
  placeholderSite: boolean;
};

/**
 * The letter for one seller. Pure, so the wording can be read and tested
 * without sending anything to anybody.
 */
export function allClearLetter(x: SellerStanding): { subject: string; html: string } {
  const subject = x.placeholderSite
    ? "Your seller account — nothing owing, but we need your web address"
    : x.canOrder
      ? "Your website is verified — you can place orders"
      : "Your website is verified — one step left";

  const apology = x.wronglyFined
    ? `<div style="border-left:3px solid #b91c1c;padding:2px 0 2px 14px;margin:14px 0;line-height:1.7">
         <p style="margin:0 0 8px"><strong>First, an apology.</strong> On 15 August we emailed you to say your
            account was on hold and that a penalty of ₹5,000 was payable, because of a discount our check found
            on your site.</p>
         <p style="margin:0 0 8px">That was our mistake. Our check had read a discount on another teacher's
            course and treated it as yours. <strong>There is nothing to pay and there never was</strong>, the hold
            is gone, and we are sorry for the trouble and for the way it was put to you.</p>
       </div>`
    : "";

  const next = x.canOrder
    ? `<p><strong>You can place orders now</strong> — go to <a href="${SITE}/supporter">your desk</a> and the
         discount code for your trading price is already filled in for you.</p>`
    : x.needsTerms
      ? `<p><strong>One thing is left before you can place orders:</strong> the seller terms have not been
           accepted on your account yet. It is one page —
           <a href="${SITE}/supporter/terms">open it here</a>, read it and press accept, and you can order
           straight away.</p>`
      : `<p>Please open <a href="${SITE}/supporter">your desk</a> to finish setting up your account, and you can
           order straight away.</p>`;

  const details = x.needsDetails
    ? `<p>Your billing details are also incomplete — your address and state decide the tax shown on your own
         invoices, so please fill them in at <a href="${SITE}/supporter/profile">your details</a>.</p>`
    : "";

  // WHAT IS ACTUALLY TRUE OF THEIR SITE.
  //
  // The placeholder account must not be congratulated on a verified website and
  // then told in the next breath that it isn't one. It reads as a form letter,
  // and a form letter is what got us here.
  const siteLine = x.placeholderSite
    ? `<p><strong>Nothing stands against your account</strong> — no hold, no penalty, nothing owing. But the
         website on your account is <strong>${x.site}</strong>, which is a placeholder rather than your shop.
         Please reply with your real web address, or add it at
         <a href="${SITE}/supporter/profile">your details</a> — the agreement is about what appears on your own
         page, so we do need to know where it is.</p>`
    : `<p>Your website <strong>${x.site}</strong> is verified on your account, and <strong>nothing stands
         against you</strong> — no hold, no penalty, nothing owing.</p>`;

  // Several accounts were opened with an address typed into the business-name
  // box. "Dear shop no 707, sector 6, c market, bhilai" is not a greeting.
  const looksLikeAName = x.name.length > 0 && x.name.length <= 45 && !/\d{2,}/.test(x.name);

  const html =
    `<p>${looksLikeAName ? `Dear ${x.name},` : "Hello,"}</p>
     ${apology}
     ${siteLine}
     ${next}
     ${details}
     <p>If anything on your account looks wrong, reply to this email and a person will read it.</p>`;

  return { subject, html };
}

export type AllClearResult = { sent: string[]; skipped: { name: string; why: string }[] };

/**
 * Send the note to every seller whose site is cleared and who has not had it.
 *
 * Never twice: `supporter_allclear_sent_at` is stamped as each one goes.
 */
export async function sendAllClearNotes(): Promise<AllClearResult> {
  const svc = createServiceClient();
  const out: AllClearResult = { sent: [], skipped: [] };

  const { data: rows } = await svc
    .from("profiles")
    .select("id, full_name, business_name, email, phone, address_line1, city, state, pincode, supporter_site, supporter_site_ok_at, supporter_terms_at, supporter_blocked_at, supporter_allclear_sent_at")
    .eq("is_supporter", true)
    .not("supporter_site_ok_at", "is", null)
    .is("supporter_blocked_at", null)
    .is("supporter_allclear_sent_at", null);

  const sellers = (rows ?? []) as Record<string, unknown>[];
  if (!sellers.length) return out;

  // Anyone with a finding still waiting to be read is left out of this.
  const { data: pendingRows } = await svc
    .from("supporter_warnings").select("supporter_id").eq("status", "pending");
  const pending = new Set((pendingRows ?? []).map((p) => String(p.supporter_id)));

  // The two the machine fined in error on 15 August.
  const { data: waived } = await svc
    .from("supporter_holds").select("supporter_id, release_note").not("released_at", "is", null);
  const wronglyFined = new Set(
    (waived ?? [])
      .filter((h) => String(h.release_note ?? "").includes("WAIVED"))
      .map((h) => String(h.supporter_id)),
  );

  const { sendEmail, emailShell } = await import("@/lib/notify");
  const str = (v: unknown) => String(v ?? "").trim();

  for (const p of sellers) {
    const id = str(p.id);
    const name = str(p.business_name) || str(p.full_name);
    const email = str(p.email);
    const site = str(p.supporter_site);

    if (pending.has(id)) { out.skipped.push({ name, why: "a finding on their site is waiting for you to read" }); continue; }
    if (!email) { out.skipped.push({ name, why: "no email address on file" }); continue; }

    const needsDetails = !(str(p.phone) && str(p.address_line1) && str(p.city) && str(p.state) && str(p.pincode));
    const standing: SellerStanding = {
      id, name, email, site,
      needsTerms: !str(p.supporter_terms_at),
      needsDetails,
      canOrder: Boolean(str(p.supporter_terms_at)) && !needsDetails,
      wronglyFined: wronglyFined.has(id),
      placeholderSite: /notavailable\.com/i.test(site),
    };

    const letter = allClearLetter(standing);
    const ok = await sendEmail(email, letter.subject, emailShell(letter.subject, letter.html)).catch(() => false);
    if (!ok) { out.skipped.push({ name, why: "the email did not go out" }); continue; }

    await svc.from("profiles")
      .update({ supporter_allclear_sent_at: new Date().toISOString() })
      .eq("id", id);
    out.sent.push(name || email);
  }

  return out;
}
