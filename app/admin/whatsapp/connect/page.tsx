import Link from "next/link";
import { assertArea } from "@/lib/adminAccess";
import { getSecret } from "@/lib/secrets";
import AdminHero from "../../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import { detectMetaAppId } from "../../integrations/actions";
import ConnectNumber from "./ConnectNumber";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connect a WhatsApp number — Admin" };

export default async function ConnectWhatsAppPage() {
  await assertArea(null);
  const appId = (await getSecret("META_APP_ID")).trim();
  const configId = (await getSecret("META_EMBEDDED_SIGNUP_CONFIG_ID")).trim();
  const personal = (await getSecret("WHATSAPP_PERSONAL_PHONE_ID")).trim();

  return (
    <section className="container" style={{ paddingTop: 24, paddingBottom: 60, maxWidth: 760 }}>
      <AdminHero
        badge="📲 Connect a number"
        title="Put your own WhatsApp number on the site — and keep it on your phone"
        subtitle="Meta calls this Coexistence: the number answers on your phone exactly as it does now, and the site can read the messages and prepare replies for you to send."
        back={{ href: "/admin/whatsapp", label: "WhatsApp inbox" }}
      />

      <div className="card" style={{ marginTop: 16 }}>
        <strong>Before you press it</strong>
        <ul style={{ margin: "8px 0 0", paddingLeft: 20, fontSize: ".9rem", lineHeight: 1.7 }}>
          <li>Your number <strong>stays on your phone</strong>. Nothing is removed and this is reversible.</li>
          <li>
            Meta will show a <strong>QR code</strong>. Scan it on your phone from{" "}
            <strong>WhatsApp Business → Settings → Linked devices → Link a device</strong> — the same place you
            link WhatsApp Web.
          </li>
          <li>
            Only <strong>students and leads</strong> are recorded. A message from anyone else is not stored, not
            answered and never seen by the site.
          </li>
          <li>The AI only ever <strong>drafts</strong> on your number. Nothing is sent until you press send.</li>
          <li>Open WhatsApp Business on your phone at least once a fortnight, or Meta drops the connection.</li>
        </ul>
      </div>

      {personal && (
        <div className="notice ok" style={{ marginTop: 16 }}>
          A personal number is already connected (ID {personal}). Running this again replaces it.
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        {appId && configId ? (
          <ConnectNumber appId={appId} configId={configId} />
        ) : (
          <>
            <strong>Two settings are needed first</strong>
            <p className="muted" style={{ fontSize: ".9rem", marginTop: 6 }}>
              Both come from the Meta app that already runs 9810079162, and both go on{" "}
              <Link href="/admin/integrations">Admin → Integrations</Link>:
            </p>
            <ul style={{ margin: "8px 0 0", paddingLeft: 20, fontSize: ".9rem", lineHeight: 1.7 }}>
              <li>
                <strong>META_APP_ID</strong> {appId ? "✅ set" : "— missing"} — no need to hunt for this: the
                WhatsApp token already names its app.
                {!appId && (
                  <form action={detectMetaAppId} style={{ marginTop: 6 }}>
                    <SubmitButton className="btn small secondary" savedLabel="Found">
                      🔎 Find it from my WhatsApp token
                    </SubmitButton>
                  </form>
                )}
              </li>
              <li>
                <strong>META_EMBEDDED_SIGNUP_CONFIG_ID</strong> {configId ? "✅ set" : "— missing"} — same app →
                WhatsApp → Configuration → create a configuration and copy its ID.
              </li>
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
