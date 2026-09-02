"use client";

import { INDIA_STATES } from "@/lib/indiaStates";
import type { Address } from "@/lib/address";

// ONE ADDRESS, ONE FIELD PER THING.
//
// His instruction, 2 September 2026: "make sure that address field is proper
// like pin code and selection of the state and everything is in separate rows
// like a professional address book. You can ask the landmark also as an
// option."
//
// So: the state is CHOSEN, never typed — a courier reads a state, and on a tax
// invoice the state is what decides CGST+SGST against IGST, so "Delhi", "New
// Delhi" and "delhi ncr" cannot all be allowed to mean the same place. The
// pincode takes six digits and nothing else. The landmark is offered and
// marked optional, because it is the line that actually gets a parcel to a
// door in most of India and no form ever asks for it.
//
// Used for both the shipping and the billing address, so the two can never
// drift apart in what they ask for.
export default function AddressFields({
  value, onChange, idPrefix, disabled = false, requirePhone = true, showLandmark = true,
}: {
  value: Address;
  onChange: (next: Address) => void;
  idPrefix: string;
  disabled?: boolean;
  requirePhone?: boolean;
  /** Off for a billing address — an invoice has no use for a landmark. */
  showLandmark?: boolean;
}) {
  const set = (k: keyof Address, v: string) => onChange({ ...value, [k]: v });
  const row: React.CSSProperties = { display: "grid", gap: 10, marginBottom: 10 };
  const two: React.CSSProperties = { display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" };

  return (
    <div style={{ opacity: disabled ? 0.55 : 1 }}>
      <div style={row}>
        <label style={{ margin: 0 }}>
          Full name
          <input id={`${idPrefix}-name`} value={value.name} disabled={disabled} autoComplete="name"
            onChange={(e) => set("name", e.target.value)} placeholder="As it should appear on the parcel" />
        </label>
      </div>
      <div style={row}>
        <label style={{ margin: 0 }}>
          Address line 1
          <input id={`${idPrefix}-line1`} value={value.line1} disabled={disabled} autoComplete="address-line1"
            onChange={(e) => set("line1", e.target.value)} placeholder="Flat / house number, building, street" />
        </label>
      </div>
      <div style={row}>
        <label style={{ margin: 0 }}>
          Address line 2 <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>
          <input id={`${idPrefix}-line2`} value={value.line2} disabled={disabled} autoComplete="address-line2"
            onChange={(e) => set("line2", e.target.value)} placeholder="Area, colony, sector" />
        </label>
      </div>
      {showLandmark && <div style={row}>
        <label style={{ margin: 0 }}>
          Landmark <span className="muted" style={{ fontWeight: 400 }}>(optional — it helps the courier find you)</span>
          <input id={`${idPrefix}-landmark`} value={value.landmark} disabled={disabled}
            onChange={(e) => set("landmark", e.target.value)} placeholder="Opposite the Metro pillar, behind the temple…" />
        </label>
      </div>}
      <div style={{ ...two, marginBottom: 10 }}>
        <label style={{ margin: 0 }}>
          City / town
          <input id={`${idPrefix}-city`} value={value.city} disabled={disabled} autoComplete="address-level2"
            onChange={(e) => set("city", e.target.value)} />
        </label>
        <label style={{ margin: 0 }}>
          PIN code
          <input id={`${idPrefix}-pincode`} value={value.pincode} disabled={disabled} autoComplete="postal-code"
            inputMode="numeric" maxLength={6} placeholder="6 digits"
            onChange={(e) => set("pincode", e.target.value.replace(/\D/g, "").slice(0, 6))} />
        </label>
      </div>
      <div style={{ ...two, marginBottom: 10 }}>
        <label style={{ margin: 0 }}>
          State
          <select id={`${idPrefix}-state`} value={value.state} disabled={disabled} autoComplete="address-level1"
            onChange={(e) => set("state", e.target.value)}>
            <option value="">— select your state —</option>
            {INDIA_STATES.map((st) => <option key={st} value={st}>{st}</option>)}
          </select>
        </label>
        <label style={{ margin: 0 }}>
          Country
          {/* The books go by courier inside India: there is no international
              service on this account, so an order taken for an address abroad
              is one that cannot be fulfilled. */}
          <input id={`${idPrefix}-country`} value="India" readOnly disabled title="We post within India only" />
        </label>
      </div>
      <div style={row}>
        <label style={{ margin: 0 }}>
          Phone {requirePhone ? "" : <span className="muted" style={{ fontWeight: 400 }}>(optional)</span>}
          <input id={`${idPrefix}-phone`} value={value.phone} disabled={disabled} autoComplete="tel" inputMode="tel"
            onChange={(e) => set("phone", e.target.value.replace(/[^\d+]/g, ""))}
            placeholder="The courier calls this number" />
        </label>
      </div>
    </div>
  );
}
