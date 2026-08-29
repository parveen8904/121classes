import AdminHero from "../../_components/AdminHero";
import { assertArea } from "@/lib/adminAccess";
import SubmitButton from "@/app/components/SubmitButton";
import { listEntities, DEFAULT_ENTITY } from "@/lib/zohoEntities";
import { connectEntityAction, setEntityActiveAction, testEntityAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Books & entities — Zoho — Admin" };

// WHOSE BOOKS THE DESK IS WORKING ON.
//
// His instruction, 30 August 2026: "there will be a choice of selecting the
// entity — either it can be me or my wife or my children — and all four Zoho
// accounts posting will be done through my portal", and, plainly, "I can later
// on continue all these things on my own portal."
//
// So the connecting lives here and not in a script. Each person creates a Self
// Client in their OWN Zoho, hands over three strings, and this page does the
// token exchange and reports which organisation it actually reached.
//
// Whether an entity can be posted to is read off the SCOPES Zoho granted, never
// off a checkbox. Read-only books say so on their own row, and the desk will not
// offer an approve button it cannot honour.

export default async function ZohoEntitiesPage() {
  await assertArea("zoho");
  const entities = await listEntities();
  const postable = entities.filter((e) => e.canPost).length;

  return (
    <main className="wrap">
      <AdminHero
        badge="Books desk"
        title="Books & entities"
        subtitle="Which sets of books this desk can work on, and who can be posted to."
        back={{ href: "/admin/zoho", label: "Zoho accounting hub" }}
      />

      <div className="card">
        <p style={{ marginTop: 0 }}>
          {entities.length} connected, {postable} of them able to receive postings. Everything on the
          rest of the desk still defaults to <strong>{DEFAULT_ENTITY}</strong> until an entity is chosen.
        </p>
      </div>

      {entities.map((e) => (
        <div className="card" key={e.slug}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
            <h3 style={{ margin: 0 }}>
              {e.name}{" "}
              <span className="muted" style={{ fontWeight: 400, fontSize: ".8rem" }}>
                {e.slug} · organisation {e.organizationId}
                {e.relationship ? ` · ${e.relationship}` : ""}
              </span>
            </h3>
            <span
              className="badge"
              style={{
                background: e.canPost ? "#E6F3F1" : "#FBF0E1",
                color: e.canPost ? "#0B6F66" : "#A45B06",
              }}
            >
              {e.canPost ? "can post" : "read-only"}
            </span>
          </div>

          {e.note && <p className="muted" style={{ fontSize: ".85rem", marginBottom: 8 }}>{e.note}</p>}
          {e.scopes && (
            <p className="muted" style={{ fontSize: ".76rem", marginBottom: 8, wordBreak: "break-word" }}>
              scopes: {e.scopes}
            </p>
          )}
          {!e.canPost && e.slug !== DEFAULT_ENTITY && (
            <p style={{ fontSize: ".85rem", color: "#A45B06", marginBottom: 8 }}>
              To allow posting, {e.name} generates a fresh code in their own Zoho with the scope{" "}
              <strong>ZohoBooks.fullaccess.all</strong> and it is re-connected below under the same short name.
              Nothing else changes.
            </p>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {e.clientId && (
              <form action={testEntityAction}>
                <input type="hidden" name="slug" value={e.slug} />
                <SubmitButton className="btn small ghost" savedLabel="✓ Checked">🔍 Check the connection</SubmitButton>
              </form>
            )}
            {e.slug !== DEFAULT_ENTITY && (
              <form action={setEntityActiveAction}>
                <input type="hidden" name="slug" value={e.slug} />
                <input type="hidden" name="active" value={e.isActive ? "0" : "1"} />
                <SubmitButton className="btn small ghost" savedLabel="✓">
                  {e.isActive ? "Hide from the desk" : "Show on the desk"}
                </SubmitButton>
              </form>
            )}
          </div>
        </div>
      ))}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Connect another set of books</h3>
        <p className="muted" style={{ fontSize: ".88rem" }}>
          The person whose books they are does this in their own Zoho, so nothing of theirs is shared
          beyond what they grant, and they can revoke it themselves at any time.
        </p>
        <ol style={{ fontSize: ".88rem", color: "#4A5A57" }}>
          <li>In <strong>their</strong> Zoho, open <code>api-console.zoho.in</code> → Get Started → <strong>Self Client</strong> → Create.</li>
          <li>On the <strong>Client Secret</strong> tab, copy the Client ID and Client Secret into the boxes below.</li>
          <li>On the <strong>Generate Code</strong> tab put the scope{" "}
            <code>ZohoBooks.fullaccess.all</code> to allow posting — or the READ scopes if the books should
            only ever be read. Set the expiry to <strong>10 minutes</strong>, add any description, press Create.</li>
          <li>Copy the generated code into the last box and press connect. The code is good for ten minutes and
            for one attempt only, so do this straight away.</li>
        </ol>
        <form action={connectEntityAction}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
            <label style={{ fontSize: ".85rem" }}>
              Short name (no spaces)
              <input name="slug" placeholder="e.g. ruchi, aarav" required style={{ marginBottom: 0 }} />
            </label>
            <label style={{ fontSize: ".85rem" }}>
              Name for the desk
              <input name="name" placeholder="e.g. Ruchi Sharma" required style={{ marginBottom: 0 }} />
            </label>
            <label style={{ fontSize: ".85rem" }}>
              Relationship
              <select name="relationship" defaultValue="child" style={{ marginBottom: 0 }}>
                <option value="self">self</option>
                <option value="spouse">spouse</option>
                <option value="child">child</option>
                <option value="family">other family</option>
              </select>
            </label>
            <label style={{ fontSize: ".85rem" }}>
              Organisation id (optional)
              <input name="organization_id" placeholder="leave blank to use the only one" style={{ marginBottom: 0 }} />
            </label>
          </div>
          <label style={{ display: "block", fontSize: ".85rem", marginTop: 10 }}>
            Client ID
            <input name="client_id" placeholder="1000.XXXXXXXX…" required style={{ marginBottom: 0 }} />
          </label>
          <label style={{ display: "block", fontSize: ".85rem", marginTop: 8 }}>
            Client Secret
            <input name="client_secret" type="password" required style={{ marginBottom: 0 }} />
          </label>
          <label style={{ display: "block", fontSize: ".85rem", marginTop: 8 }}>
            Generated code — expires in ten minutes
            <input name="code" placeholder="1000.XXXXXXXX…" required style={{ marginBottom: 0 }} />
          </label>
          <SubmitButton className="btn" savedLabel="✓ Connected">🔗 Connect these books</SubmitButton>
        </form>
        <p className="muted" style={{ fontSize: ".8rem", marginTop: 10 }}>
          Whether the books can be posted to is decided by the scopes Zoho grants, not by anything ticked
          here. Connect with read scopes and the row will say read-only until it is re-connected with write
          scopes under the same short name.
        </p>
      </div>
    </main>
  );
}
