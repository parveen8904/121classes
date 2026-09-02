"use client";

import { checkGstin } from "@/lib/gstin";

// THE GST NUMBER, CHECKED WHILE IT IS TYPED.
//
// His instruction, 2 September 2026: "GST number — in case the profile carries
// the GST number it must be there, otherwise you can give the option to the
// student also that if you have GST you can put it here, and the same GSTIN
// will also be posted to the profile."
//
// So: prefilled from the profile when we have it, offered plainly when we do
// not, never demanded. A buyer without a GST number is the normal case and is
// not made to feel they have failed a form.
//
// The number is verified here without asking anybody: a GSTIN carries its own
// check digit, and the first two characters are the state code. Both are
// arithmetic, so a mistyped character is caught before the order is placed —
// and the state it names is shown back, which is the fastest way to notice you
// pasted somebody else's number. What arithmetic CANNOT say is whether the
// registration exists or is active; that needs a lookup provider, and the copy
// does not pretend otherwise.
export default function GstinField({
  value, onChange, fromProfile,
}: { value: string; onChange: (v: string) => void; fromProfile: boolean }) {
  const typed = value.trim();
  const check = typed ? checkGstin(typed) : null;

  return (
    <div style={{ marginTop: 4 }}>
      <label style={{ margin: 0 }}>
        GST number <span className="muted" style={{ fontWeight: 400 }}>(optional — only if you want the invoice in a business name)</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 15))}
          placeholder="15 characters, e.g. 07AAYPS3155J1ZY"
          style={{ fontFamily: "ui-monospace, monospace", letterSpacing: ".04em" }}
        />
      </label>
      {fromProfile && !typed && (
        <p className="muted" style={{ fontSize: ".8rem", margin: "4px 0 0" }}>
          You had a GST number saved — clearing it here leaves this order without one.
        </p>
      )}
      {check && !check.ok && (
        <p style={{ fontSize: ".8rem", margin: "4px 0 0", color: "#b91c1c" }}>{check.problem}</p>
      )}
      {check?.ok && (
        <p style={{ fontSize: ".8rem", margin: "4px 0 0", color: "#15803d" }}>
          ✓ Well formed · registered in <strong>{check.state}</strong> · PAN {check.pan}
          {fromProfile ? " · from your profile" : " · this will be saved to your profile"}
        </p>
      )}
    </div>
  );
}
