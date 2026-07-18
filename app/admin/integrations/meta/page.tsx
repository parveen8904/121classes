import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AdminHero from "../../_components/AdminHero";
import SubmitButton from "@/app/components/SubmitButton";
import { getSecret } from "@/lib/secrets";
import { useMetaAccount } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Instagram / Facebook check — Admin" };

const GRAPH = "https://graph.facebook.com/v21.0";

type PageRow = { id: string; name: string; ig?: { id: string; username?: string } | null };

// Plain-English view of the founder's Meta setup: which Facebook Pages the
// token can see, which one has Instagram linked, and one button to wire the
// right Instagram account into auto-posting.
export default async function MetaCheck(props: { searchParams: Promise<{ saved?: string }> }) {
  const searchParams = await props.searchParams;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/integrations/meta");
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") redirect("/dashboard");

  const token = await getSecret("INSTAGRAM_ACCESS_TOKEN");
  const savedIgId = await getSecret("INSTAGRAM_USER_ID");

  let pages: PageRow[] = [];
  let error: string | null = null;
  let tokenUser: string | null = null;

  if (token) {
    try {
      const meRes = await fetch(`${GRAPH}/me?fields=name&access_token=${encodeURIComponent(token)}`, { cache: "no-store" });
      const meJson = (await meRes.json()) as { name?: string; error?: { message?: string } };
      if (meJson.error) error = meJson.error.message ?? "Token was rejected by Meta.";
      else tokenUser = meJson.name ?? null;

      if (!error) {
        const res = await fetch(
          `${GRAPH}/me/accounts?fields=id,name,instagram_business_account{id,username}&limit=50&access_token=${encodeURIComponent(token)}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as { data?: { id: string; name: string; instagram_business_account?: { id: string; username?: string } }[]; error?: { message?: string } };
        if (json.error) error = json.error.message ?? "Could not list your Facebook Pages.";
        else pages = (json.data ?? []).map((p) => ({ id: p.id, name: p.name, ig: p.instagram_business_account ?? null }));
      }
    } catch {
      error = "Could not reach Meta — please try again.";
    }
  }

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 760 }}>
      <AdminHero
        badge="📷 Instagram / Facebook"
        title="Your Meta setup, explained"
        subtitle="This reads your access token and shows in plain words what Pages you have and which Instagram is linked — then wires the right one into auto-posting with one tap. 🙌"
        back={{ href: "/admin/integrations", label: "Integrations" }}
      />

      {searchParams.saved && <div className="notice ok" style={{ marginTop: 14 }}>✅ Instagram account connected — campaigns will now auto-post to it.</div>}

      {!token ? (
        <div className="card" style={{ marginTop: 18 }}>
          <p style={{ margin: 0 }}>
            🔑 First paste your <strong>Instagram access token</strong> on the{" "}
            <Link href="/admin/integrations" style={{ color: "var(--accent)", fontWeight: 700 }}>Integrations page</Link>, then come back here —
            I&apos;ll read your account and show everything.
          </p>
        </div>
      ) : error ? (
        <div className="card" style={{ marginTop: 18, border: "2px solid #ef4444" }}>
          <strong>❌ Meta rejected the token</strong>
          <p className="muted" style={{ margin: "6px 0 0" }}>{error}</p>
          <p className="muted" style={{ fontSize: ".85rem", marginTop: 8 }}>
            Usually this means the token expired (they last ~60 days) or is missing the permissions
            <code> instagram_basic</code>, <code>instagram_content_publish</code>, <code>pages_show_list</code>.
            Generate a fresh long-lived token and re-paste it on Integrations.
          </p>
        </div>
      ) : (
        <>
          <div className="card" style={{ marginTop: 18 }}>
            <strong>✅ Token works</strong>
            <p className="muted" style={{ margin: "6px 0 0" }}>
              Logged in as <strong>{tokenUser ?? "your Meta account"}</strong> · {pages.length} Facebook Page{pages.length === 1 ? "" : "s"} found.
            </p>
          </div>

          <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
            {pages.length === 0 && (
              <div className="card">
                <p style={{ margin: 0 }}>😕 This token can&apos;t see any Facebook Pages. In the token screen, make sure you granted access to your Page(s) and included <code>pages_show_list</code>.</p>
              </div>
            )}
            {pages.map((p) => (
              <div key={p.id} className="list-row" style={{ flexWrap: "wrap", border: p.ig && p.ig.id === savedIgId ? "2px solid #16a34a" : undefined }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span className="row-title">📘 {p.name}</span>
                  <p className="row-sub">
                    {p.ig
                      ? <>📷 Instagram linked: <strong>@{p.ig.username ?? p.ig.id}</strong>{p.ig.id === savedIgId ? " · ✅ connected for auto-posting" : ""}</>
                      : "No Instagram linked to this Page"}
                  </p>
                </div>
                <div className="row-actions">
                  {p.ig && p.ig.id !== savedIgId && (
                    <form action={useMetaAccount}>
                      <input type="hidden" name="ig_id" value={p.ig.id} />
                      <SubmitButton className="btn small">✅ Use this Instagram</SubmitButton>
                    </form>
                  )}
                  {p.ig && p.ig.id === savedIgId && <span style={{ color: "#16a34a", fontWeight: 700, fontSize: ".85rem" }}>Connected</span>}
                </div>
              </div>
            ))}
          </div>

          <div className="card" style={{ marginTop: 18 }}>
            <strong>ℹ️ What this means</strong>
            <ul style={{ fontSize: ".88rem", margin: "8px 0 0 18px", display: "grid", gap: 4 }}>
              <li>Each row is a <strong>Facebook Page</strong> your account manages. Only a Page can have an Instagram professional account linked.</li>
              <li>Pick the row showing your real <strong>@instagram handle</strong> and press “Use this Instagram” — campaigns then post there automatically.</li>
              <li>Extra Pages you don&apos;t use are harmless — you can ignore or delete them inside Facebook (Settings → General → Remove Page).</li>
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
