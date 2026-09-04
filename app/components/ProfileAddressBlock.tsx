"use client";

import { useState } from "react";
import { INDIA_STATES } from "@/lib/indiaStates";

// THE ADDRESS ON A PROFILE PAGE, AS A PLAIN FORM.
//
// Ravi's spec of 2 September 2026, two Medium items:
//
//   "State is currently a manual text field → change State field to a
//    dropdown. Student should select the State from a predefined list."
//   "Country selection is currently not available → add Country field with
//    India / Other Country options. India → show Indian State dropdown. Other
//    Country → show appropriate international Country, State/Province/Region,
//    City, PIN/ZIP and Address fields."
//
// Why it matters more than a tidiness fix: the state decides CGST+SGST against
// IGST and prints as the state code on a GST invoice. One student's invoice
// came out reading "State Code:-" because this was a text box and he typed his
// PIN code into it.
//
// This posts ordinary named fields, so the server actions that already read
// address_line1/2, city, state, pincode keep working untouched — the only new
// name is `country`. The GST box verifies on demand and fills the rest in when
// a lookup provider is connected; without one it still confirms the number and
// names its state, which needs nobody.
export default function ProfileAddressBlock({
  initial, required = false, showGst = true, idPrefix = "p",
}: {
  initial: {
    address_line1?: string | null; address_line2?: string | null;
    city?: string | null; state?: string | null; pincode?: string | null;
    country?: string | null; gstin?: string | null; business_name?: string | null;
    trade_name?: string | null;
  };
  required?: boolean;
  showGst?: boolean;
  idPrefix?: string;
}) {
  const [country, setCountry] = useState(initial.country?.trim() || "India");
  const [state, setState] = useState(initial.state ?? "");
  const [line1, setLine1] = useState(initial.address_line1 ?? "");
  const [line2, setLine2] = useState(initial.address_line2 ?? "");
  const [city, setCity] = useState(initial.city ?? "");
  const [pincode, setPincode] = useState(initial.pincode ?? "");
  const [gstin, setGstin] = useState(initial.gstin ?? "");
  const [tradeName, setTradeName] = useState(initial.trade_name || initial.business_name || "");
  const inIndia = country.trim().toLowerCase() === "india";
  const star = required ? <span style={{ color: "#b91c1c" }}> *</span> : null;

  return (
    <>
      <label htmlFor={`${idPrefix}-country`}>Country</label>
      <select id={`${idPrefix}-country`} value={inIndia ? "India" : "Other"}
        onChange={(e) => { setCountry(e.target.value === "India" ? "India" : ""); setState(""); setPincode(""); }}>
        <option value="India">India</option>
        <option value="Other">Other country</option>
      </select>
      {!inIndia && (
        <input name="country" value={country} onChange={(e) => setCountry(e.target.value)}
          placeholder="Which country?" style={{ marginTop: 8 }} required={required} />
      )}
      {inIndia && <input type="hidden" name="country" value="India" />}

      <label htmlFor={`${idPrefix}-line1`}>Address line 1{star}</label>
      <input id={`${idPrefix}-line1`} name="address_line1" value={line1} required={required}
        autoComplete="address-line1" onChange={(e) => setLine1(e.target.value)} />
      <label htmlFor={`${idPrefix}-line2`}>Address line 2</label>
      <input id={`${idPrefix}-line2`} name="address_line2" value={line2}
        autoComplete="address-line2" onChange={(e) => setLine2(e.target.value)} />

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr 1fr" }}>
        <div>
          <label htmlFor={`${idPrefix}-city`}>City{star}</label>
          <input id={`${idPrefix}-city`} name="city" value={city} required={required}
            autoComplete="address-level2" onChange={(e) => setCity(e.target.value)} />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-state`}>{inIndia ? "State" : "State / province / region"}{star}</label>
          {inIndia ? (
            <select id={`${idPrefix}-state`} name="state" value={state} required={required}
              onChange={(e) => setState(e.target.value)}>
              <option value="">— select your state —</option>
              {INDIA_STATES.map((st) => <option key={st} value={st}>{st}</option>)}
            </select>
          ) : (
            <input id={`${idPrefix}-state`} name="state" value={state} required={required}
              placeholder="Province, region or state" onChange={(e) => setState(e.target.value)} />
          )}
        </div>
        <div>
          <label htmlFor={`${idPrefix}-pincode`}>{inIndia ? "PIN code" : "PIN / ZIP"}{star}</label>
          <input id={`${idPrefix}-pincode`} name="pincode" value={pincode} required={required}
            autoComplete="postal-code" inputMode={inIndia ? "numeric" : "text"}
            maxLength={inIndia ? 6 : 12} placeholder={inIndia ? "6 digits" : "Postal code"}
            onChange={(e) => setPincode(inIndia
              ? e.target.value.replace(/\D/g, "").slice(0, 6)
              : e.target.value.toUpperCase().replace(/[^0-9A-Z -]/g, "").slice(0, 12))} />
        </div>
      </div>
      <p className="muted" style={{ fontSize: ".8rem", marginTop: 4 }}>
        {inIndia
          ? "The state is what decides whether your invoice carries CGST + SGST or IGST, so it is chosen from the list rather than typed."
          : "Outside India, put your own country’s province and postcode — both boxes take anything."}
      </p>

      {showGst && (
        <div style={{ marginTop: 12 }}>
          <label htmlFor={`${idPrefix}-gstin`}>GST number <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label>
          {/* NO VERIFY BUTTON. Removed 4 September 2026 on the team's
              instruction — "we do not require the GST verification
              functionality". The number is typed and taken as given; the trade
              name is typed beside it rather than fetched. */}
          <input id={`${idPrefix}-gstin`} name="gstin" value={gstin}
            style={{ fontFamily: "ui-monospace, monospace", letterSpacing: ".04em" }}
            onChange={(e) => setGstin(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 15))}
            placeholder="15 characters, e.g. 07AAYPS3155J1ZY" />
          <label htmlFor={`${idPrefix}-trade`} style={{ marginTop: 8 }}>
            Trade / legal name <span className="muted" style={{ fontWeight: 400 }}>(as registered under GST)</span>
          </label>
          <input id={`${idPrefix}-trade`} name="business_name" value={tradeName}
            onChange={(e) => setTradeName(e.target.value)}
            placeholder="Type it exactly as printed on the GST certificate" />
          <input type="hidden" name="trade_name" value={tradeName} />
        </div>
      )}
    </>
  );
}
