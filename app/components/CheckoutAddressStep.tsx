"use client";

import { useEffect, useState } from "react";
import AddressFields from "./AddressFields";
import { myAddressBook, verifyGstin, type CheckoutDetails, type ShipChoice } from "@/app/books/cartActions";
import { EMPTY_ADDRESS, addressDifferences, addressProblems, addressLines, type Address } from "@/lib/address";

// THE ADDRESS STEP, AND NOBODY REACHES A PAYMENT GATEWAY WITHOUT IT.
//
// Ravi's spec of 2 September 2026 puts this at Critical, and its reason is the
// part worth keeping in mind: "No payment should be initiated until the user
// confirms the Billing and Shipping details on every enrollment... even if the
// student has enrolled previously and their address details are already saved."
//
// Saved details are exactly the ones that go stale. A student who moved in
// March and enrols again in September will sail past a prefilled form without
// reading it, and the parcel goes to the old flat. So the addresses are SHOWN
// BACK, and the button that opens the gateway does not exist until someone has
// looked at them and said yes.
//
// The order of the screen is his too — billing first, shipping derived from it:
//
//   Billing Address → GST (optional) → verify → Shipping choice → Review → Pay
//
// And the shipping choice has three states, not two. "Neither option should be
// selected by default... No option selected → Billing Address should be
// considered as Shipping Address." Nothing is pre-ticked, and leaving it alone
// is a documented answer rather than an error.

export type Confirmed = CheckoutDetails;

export default function CheckoutAddressStep({
  onConfirmedChange, heading = "Billing & delivery",
}: {
  /** Non-null only while the buyer is looking at details they have confirmed. */
  onConfirmedChange: (d: Confirmed | null) => void;
  heading?: string;
}) {
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [email, setEmail] = useState("");
  const [billing, setBilling] = useState<Address>(EMPTY_ADDRESS);
  const [shipping, setShipping] = useState<Address>(EMPTY_ADDRESS);
  const [shipTo, setShipTo] = useState<ShipChoice>("unset");
  const [gstin, setGstin] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [gstNote, setGstNote] = useState<{ tone: "ok" | "warn" | "bad"; text: string } | null>(null);
  const [checking, setChecking] = useState(false);
  // Set once a check has shown there is no lookup service — the box then asks
  // for the name instead of promising to fill it in by itself.
  const [typeTheName, setTypeTheName] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [onFile, setOnFile] = useState<{ billing: Address; shipping: Address; signedIn: boolean; hadGstin: boolean } | null>(null);

  useEffect(() => {
    myAddressBook().then((b) => {
      setOnFile({ billing: b.billing, shipping: b.shipping, signedIn: b.signedIn, hadGstin: b.hasProfileGstin });
      if (b.email) setEmail(b.email);
      if (b.billing.line1) setBilling(b.billing);
      if (b.shipping.line1) setShipping(b.shipping);
      if (b.gstin) setGstin(b.gstin);
      if (b.tradeName) setTradeName(b.tradeName);
    }).catch(() => { /* an empty form still works */ });
  }, []);

  // ANY EDIT UNDOES THE CONFIRMATION. Otherwise someone confirms, changes the
  // PIN code, and pays against the address they were shown rather than the one
  // they typed — which is the failure this whole step exists to prevent.
  useEffect(() => {
    setStep("edit");
    onConfirmedChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, billing, shipping, shipTo, gstin, tradeName]);

  const effectiveShipping = shipTo === "different" ? shipping : billing;

  async function checkGst() {
    if (!gstin.trim()) { setGstNote(null); return; }
    setChecking(true);
    try {
      const r = await verifyGstin(gstin);
      if (!r.valid) { setGstNote({ tone: "bad", text: r.problem ?? "That GST number is not valid." }); return; }
      if (r.fetched && r.party) {
        // EXACTLY AS REGISTERED — no title-casing, no trimming of inner
        // spacing. "M/s. RAVI ENTERPRISES" and "M/s Ravi Enterprises" are not
        // the same legal name, and an invoice that tidies one disagrees with
        // the register it is quoting.
        setTradeName(r.party.tradeName ?? r.party.legalName ?? "");
        setLegalName(r.party.legalName ?? "");
        setBilling((b) => ({
          ...b,
          name: r.party!.tradeName || r.party!.legalName || b.name,
          line1: r.party!.line1 || b.line1,
          line2: r.party!.line2 || b.line2,
          city: r.party!.city || b.city,
          state: r.party!.state || b.state,
          pincode: r.party!.pincode || b.pincode,
          country: "India",
        }));
        // Say where it came from — see ProfileAddressBlock. With no GST lookup
        // service connected these details come out of Zoho Books.
        setGstNote({
          tone: "ok",
          text: `Verified — ${r.party.tradeName || r.party.legalName}${r.party.status ? ` (${r.party.status})` : ""}. `
            + (r.note === "from your Zoho Books contact record"
              ? "The billing address has been filled in from your Zoho Books record — please check it."
              : "The billing address has been filled in from the GST records."),
        });
      } else if (!r.configured) {
        // The number IS verified — checksum, PAN and state all check out
        // without asking anybody. Only the name and address need an outside
        // service, and none is connected. See ProfileAddressBlock.
        setTypeTheName(true);
        setGstNote({
          tone: "ok",
          text: `Valid GST number — PAN ${r.pan}, registered in ${r.state}. `
            + "We have no record of this number yet, so please fill in the name and address yourself.",
        });
      } else {
        setGstNote({
          tone: "warn",
          text: `${r.note ?? "The trade name could not be fetched."} Registered in ${r.state}. Please fill the billing address yourself.`,
        });
      }
    } catch {
      setGstNote({ tone: "warn", text: "Could not reach the GST service just now — the number itself looks right." });
    } finally { setChecking(false); }
  }

  function toReview() {
    const found = [
      ...addressProblems(billing, { needPhone: false, indiaOnly: false }).map((m) => `billing: ${m}`),
      ...addressProblems(effectiveShipping).map((m) => `delivery: ${m}`),
    ];
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) found.push("an email address for the invoice");
    setProblems(found);
    if (found.length) return;
    setStep("review");
    onConfirmedChange(null);
  }

  const billDiff = onFile ? addressDifferences(billing, onFile.billing) : [];

  if (step === "review") {
    return (
      <div className="card">
        <h3 style={{ marginBottom: 4 }}>👀 Please check these before you pay</h3>
        <p className="muted" style={{ fontSize: ".82rem", margin: "0 0 14px" }}>
          We ask every time, even if you have ordered before — an address saved months ago is exactly the one that
          turns out to have changed.
        </p>

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
          <Panel title="🧾 Billing address" onEdit={() => setStep("edit")}>
            {addressLines(billing).map((l, i) => <div key={i}>{l}</div>)}
            {gstin && <div style={{ marginTop: 6 }}><strong>GST</strong> {gstin}</div>}
            {tradeName && <div>{tradeName}</div>}
            <div className="muted" style={{ marginTop: 6, fontSize: ".78rem" }}>Invoice goes to {email}</div>
          </Panel>
          <Panel title="🚚 Delivery address" onEdit={() => setStep("edit")}>
            {addressLines(effectiveShipping).map((l, i) => <div key={i}>{l}</div>)}
            {shipTo !== "different" && (
              <div className="muted" style={{ marginTop: 6, fontSize: ".78rem" }}>
                {shipTo === "same" ? "Same as the billing address." : "No separate delivery address chosen, so the billing address is used."}
              </div>
            )}
          </Panel>
        </div>

        <button className="btn block" type="button" style={{ marginTop: 14 }}
          onClick={() => onConfirmedChange({ email: email.trim(), billing, shipTo, shipping, gstin, tradeName, legalName })}>
          ✅ Yes, these are correct — continue to payment
        </button>
        <button className="btn secondary block" type="button" style={{ marginTop: 8 }} onClick={() => setStep("edit")}>
          ✏️ Change something
        </button>
      </div>
    );
  }

  return (
    <div className="card">
      <h3 style={{ marginBottom: 4 }}>🧾 {heading}</h3>
      <p className="muted" style={{ fontSize: ".82rem", margin: "0 0 12px" }}>
        {onFile?.signedIn ? "Filled in from your profile — change anything that has moved." : "We keep these on your profile, so this is the last time you type them."}
      </p>

      <label style={{ margin: "0 0 10px" }}>
        Email <span className="muted" style={{ fontWeight: 400 }}>(the invoice goes here)</span>
        <input type="email" value={email} autoComplete="email" onChange={(e) => setEmail(e.target.value)} />
      </label>

      <strong style={{ display: "block", margin: "6px 0 8px" }}>Billing address</strong>
      <AddressFields idPrefix="bill" value={billing} onChange={setBilling}
        requirePhone={false} showLandmark={false} allowOutsideIndia />
      {billDiff.length > 0 && (
        <p style={{ fontSize: ".8rem", margin: "0 0 10px", color: "#b45309" }}>
          Your profile has a different billing address on file ({billDiff.join(", ")}). What is typed here will be used,
          and your profile updated to match.
        </p>
      )}

      {/* GST — optional, verified, and it fills the rest in when it can. */}
      <div style={{ margin: "6px 0 4px" }}>
        <label style={{ margin: 0 }}>
          GST number <span className="muted" style={{ fontWeight: 400 }}>(optional — only if the invoice should be in a business name)</span>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={gstin} style={{ fontFamily: "ui-monospace, monospace", letterSpacing: ".04em" }}
              onChange={(e) => { setGstin(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 15)); setGstNote(null); }}
              placeholder="15 characters, e.g. 07AAYPS3155J1ZY" />
            <button className="btn small secondary" type="button" onClick={checkGst} disabled={checking || gstin.length !== 15}
              style={{ whiteSpace: "nowrap" }}>
              {checking ? "Checking…" : "Verify"}
            </button>
          </div>
        </label>
        {gstNote && (
          <p style={{ fontSize: ".8rem", margin: "4px 0 0", color: gstNote.tone === "ok" ? "#15803d" : gstNote.tone === "warn" ? "#b45309" : "#b91c1c" }}>
            {gstNote.text}
          </p>
        )}
        {(tradeName || gstin) && (
          <label style={{ margin: "8px 0 0" }}>
            Trade / legal name <span className="muted" style={{ fontWeight: 400 }}>(as registered under GST)</span>
            <input value={tradeName} onChange={(e) => setTradeName(e.target.value)}
              placeholder={typeTheName ? "Type it exactly as printed on the GST certificate" : "Filled in automatically once the GST number is verified"} />
          </label>
        )}
      </div>

      {/* SHIPPING — three states, none of them pre-ticked. */}
      <strong style={{ display: "block", margin: "16px 0 8px" }}>Delivery address</strong>
      <div style={{ display: "grid", gap: 7, marginBottom: 10 }}>
        <label className="remember" style={{ display: "flex", gap: 8, alignItems: "center", margin: 0 }}>
          <input type="radio" name="shipto" checked={shipTo === "same"} onChange={() => setShipTo("same")} />
          Same as the billing address
        </label>
        <label className="remember" style={{ display: "flex", gap: 8, alignItems: "center", margin: 0 }}>
          <input type="radio" name="shipto" checked={shipTo === "different"} onChange={() => setShipTo("different")} />
          Ship to a different address
        </label>
        {shipTo === "unset" && (
          <span className="muted" style={{ fontSize: ".78rem" }}>
            If you choose neither, we will send it to the billing address above.
          </span>
        )}
      </div>
      {shipTo === "different" && (
        <AddressFields idPrefix="ship" value={shipping} onChange={setShipping} />
      )}

      {problems.length > 0 && (
        <div style={{ marginTop: 12, padding: "9px 12px", borderRadius: 8, background: "rgba(185,28,28,.08)" }}>
          <strong style={{ fontSize: ".84rem", color: "#b91c1c" }}>Still needed:</strong>
          <ul style={{ margin: "5px 0 0 18px", fontSize: ".82rem", color: "#b91c1c" }}>
            {problems.map((m) => <li key={m}>{m}</li>)}
          </ul>
        </div>
      )}

      <button className="btn block" type="button" style={{ marginTop: 14 }} onClick={toReview}>
        Review these details →
      </button>
    </div>
  );
}

function Panel({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <div style={{ padding: "10px 13px", borderRadius: 10, background: "var(--bg-soft)", fontSize: ".85rem", lineHeight: 1.5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <strong>{title}</strong>
        <button className="btn small secondary" type="button" onClick={onEdit}>✏️ Edit</button>
      </div>
      {children}
    </div>
  );
}
