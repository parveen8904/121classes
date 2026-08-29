"use server";

import { revalidatePath } from "next/cache";
import { assertArea } from "@/lib/adminAccess";
import { createServiceClient } from "@/lib/supabase/service";
import { DEFAULT_ENTITY } from "@/lib/zohoEntities";

// CONNECTING SOMEONE ELSE'S BOOKS, FROM THE PORTAL.
//
// His instruction, 30 Aug 2026: he wants to keep doing this himself. So the
// whole exchange lives here rather than in anyone's console: paste the three
// things Zoho gives you, press connect, and the portal does the token swap and
// tells you which organisation it reached.
//
// The grant code is the perishable part — Zoho voids it in ten minutes and it
// is single-use, so this is deliberately a one-shot form with a plain error
// when the code has gone stale, not a silent failure.

const ACCOUNTS = "https://accounts.zoho.in";
const API = "https://www.zohoapis.in";

const clean = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/** Swap a Self-Client grant code for a refresh token, then store the entity. */
export async function connectEntityAction(fd: FormData) {
  await assertArea("zoho");
  const slug = clean(fd, "slug").toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const name = clean(fd, "name");
  const clientId = clean(fd, "client_id");
  const clientSecret = clean(fd, "client_secret");
  const code = clean(fd, "code");
  const relationship = clean(fd, "relationship") || "family";
  if (!slug || !name) throw new Error("Give the entity a short name and a display name.");
  if (!clientId || !clientSecret || !code) {
    throw new Error("Client ID, client secret and the generated code are all needed.");
  }

  const res = await fetch(`${ACCOUNTS}/oauth/v2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", client_id: clientId,
      client_secret: clientSecret, code,
    }),
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as {
    refresh_token?: string; access_token?: string; scope?: string; error?: string;
  };
  if (!j.refresh_token || !j.access_token) {
    const why = String(j.error || "no refresh token came back");
    throw new Error(
      /invalid.?code|expired/i.test(why)
        ? "That code has already been used or has expired — Zoho only allows ten minutes and one attempt. Generate a fresh one and try again."
        : `Zoho refused the exchange: ${why}`,
    );
  }

  // Ask Zoho which organisation this credential actually reaches, rather than
  // trusting anyone to type an id correctly.
  const orgRes = await fetch(`${API}/books/v3/organizations`, {
    headers: { Authorization: `Zoho-oauthtoken ${j.access_token}` },
    cache: "no-store",
  });
  const orgJson = (await orgRes.json().catch(() => ({}))) as {
    organizations?: { organization_id: string; name: string }[];
  };
  const orgs = orgJson.organizations ?? [];
  if (orgs.length === 0) {
    throw new Error("The credential worked but reaches no Zoho Books organisation. Check the scopes include ZohoBooks.");
  }
  const wanted = clean(fd, "organization_id");
  const org = wanted ? orgs.find((o) => o.organization_id === wanted) : orgs[0];
  if (!org) {
    throw new Error(
      `That credential reaches ${orgs.map((o) => `${o.name} (${o.organization_id})`).join(", ")}, not the organisation id given.`,
    );
  }

  // Whether it can post is decided by the SCOPES Zoho granted, never by a
  // checkbox someone ticks hopefully. A read scope cannot write, and the desk
  // must not offer an approve button that Zoho will refuse.
  const scopes = String(j.scope ?? "");
  const canPost = /fullaccess|\.CREATE|\.UPDATE|\.ALL/i.test(scopes);

  const svc = createServiceClient();
  const { error } = await svc.from("zoho_entities").upsert({
    slug, name, organization_id: org.organization_id,
    client_id: clientId, client_secret: clientSecret, refresh_token: j.refresh_token,
    can_post: canPost, scopes, relationship, is_active: true,
    note: canPost
      ? "Connected with write scopes — entries can be posted to these books."
      : "Connected READ-ONLY. Reports and tax working all work; nothing can be posted. Re-connect with ZohoBooks.fullaccess.all to allow posting.",
    updated_at: new Date().toISOString(),
  }, { onConflict: "slug" });
  if (error) throw new Error(`The entity could not be saved: ${error.message}`);
  revalidatePath("/admin/zoho/entities");
  revalidatePath("/admin/zoho");
}

export async function setEntityActiveAction(fd: FormData) {
  await assertArea("zoho");
  const slug = clean(fd, "slug");
  const active = clean(fd, "active") === "1";
  if (slug === DEFAULT_ENTITY && !active) {
    throw new Error("The founder's own books cannot be switched off — everything defaults to them.");
  }
  const svc = createServiceClient();
  await svc.from("zoho_entities").update({ is_active: active, updated_at: new Date().toISOString() }).eq("slug", slug);
  revalidatePath("/admin/zoho/entities");
}

/** Prove a stored credential still works, and say which organisation it reaches. */
export async function testEntityAction(fd: FormData) {
  await assertArea("zoho");
  const slug = clean(fd, "slug");
  const svc = createServiceClient();
  const { data } = await svc.from("zoho_entities")
    .select("name, organization_id, client_id, client_secret, refresh_token, can_post")
    .eq("slug", slug).maybeSingle();
  if (!data) throw new Error("No such entity.");
  if (!data.client_id) throw new Error("This entity uses the portal-wide credential — test it on the accounting hub instead.");

  const res = await fetch(`${ACCOUNTS}/oauth/v2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token", client_id: String(data.client_id),
      client_secret: String(data.client_secret), refresh_token: String(data.refresh_token),
    }),
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!j.access_token) throw new Error(`Zoho refused ${data.name}'s credential: ${j.error ?? "unknown"}`);

  const bs = await fetch(
    `${API}/books/v3/reports/balancesheet?organization_id=${data.organization_id}&to_date=${new Date().toISOString().slice(0, 10)}`,
    { headers: { Authorization: `Zoho-oauthtoken ${j.access_token}` }, cache: "no-store" },
  );
  const ok = (await bs.json().catch(() => ({}))) as { code?: number; message?: string };
  await svc.from("zoho_entities").update({
    note: ok.code === 0
      ? `Checked ${new Date().toISOString().slice(0, 10)} — the credential works and reads the books.`
      : `Checked ${new Date().toISOString().slice(0, 10)} — Zoho answered: ${ok.message ?? "unknown"}`,
    updated_at: new Date().toISOString(),
  }).eq("slug", slug);
  revalidatePath("/admin/zoho/entities");
}
