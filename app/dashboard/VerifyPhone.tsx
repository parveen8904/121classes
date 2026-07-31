"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { sendPhoneCode, checkPhoneCode, type PhoneState } from "./phone-actions";

// The soft prompt: a card asking the student to confirm the WhatsApp number
// we already hold. Nothing is blocked if they ignore it — but class alerts,
// reminders and account recovery all ride on this number being real.

function Btn({ children, wait }: { children: React.ReactNode; wait: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn small" type="submit" disabled={pending}>
      {pending ? wait : children}
    </button>
  );
}

export default function VerifyPhone({ phone }: { phone: string }) {
  const [sendState, doSend] = useActionState<PhoneState, FormData>(sendPhoneCode, {});
  const [checkState, doCheck] = useActionState<PhoneState, FormData>(checkPhoneCode, {});

  if (checkState.done) {
    return (
      <div className="card" style={{ marginTop: 14, borderColor: "#16a34a" }}>
        <p style={{ margin: 0 }}>
          ✅ <strong>WhatsApp number confirmed</strong> — class alerts and important updates will reach you here.
        </p>
      </div>
    );
  }

  const awaitingCode = sendState.sent || checkState.sent;
  const current = checkState.phone ?? sendState.phone ?? phone;

  return (
    <div className="card" style={{ marginTop: 14, border: "2px solid var(--accent)" }}>
      <strong>📱 Confirm your WhatsApp number</strong>
      <p className="muted" style={{ fontSize: ".85rem", margin: "6px 0 10px" }}>
        We send class alerts, test reports and account help on WhatsApp. Confirm your number once so nothing important is
        missed.
      </p>

      {!awaitingCode ? (
        <form action={doSend}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              name="phone"
              defaultValue={current}
              placeholder="WhatsApp number"
              inputMode="tel"
              maxLength={15}
              style={{ maxWidth: 220 }}
            />
            <Btn wait="Sending…">Send code on WhatsApp</Btn>
          </div>
          {sendState.error && (
            <p className="muted" style={{ color: "#b91c1c", fontSize: ".85rem", marginTop: 8 }}>
              {sendState.error}
            </p>
          )}
        </form>
      ) : (
        <form action={doCheck}>
          <input type="hidden" name="phone" value={current} />
          <p className="muted" style={{ fontSize: ".85rem", margin: "0 0 8px" }}>
            We sent a 6-digit code to <strong>{current}</strong> on WhatsApp. It expires in 10 minutes.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input name="code" placeholder="6-digit code" inputMode="numeric" maxLength={6} style={{ maxWidth: 140 }} />
            <Btn wait="Checking…">Confirm</Btn>
          </div>
          {checkState.error && (
            <p className="muted" style={{ color: "#b91c1c", fontSize: ".85rem", marginTop: 8 }}>
              {checkState.error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
