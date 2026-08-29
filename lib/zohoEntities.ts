import { createServiceClient } from "@/lib/supabase/service";
import { getSecret } from "@/lib/secrets";

// FOUR SETS OF BOOKS, ONE DESK.
//
// His instruction, 30 August 2026: "there will be a choice of selecting the
// entity where either it can be me or my wife or my children, and all four Zoho
// accounts posting will be done through my portal."
//
// The portal was built for one organisation — a single ZOHO_ORG_ID secret
// stamped on every call. This is the layer that makes it many. Each entity
// carries its own organisation id and, where it has one, its own OAuth
// credential; an entity with no credential of its own falls back to the
// portal-wide secrets, which is how the founder's own books already work, so
// nothing about them changes.
//
// The one rule that matters: READ-ONLY MEANS READ-ONLY. His wife's credential
// was created in her own Zoho with READ scopes only. A desk that offers an
// approve button for books it cannot write to is worse than one that offers
// nothing, so `canPost` travels with the entity and the posting paths check it
// BEFORE they build a queue, not after Zoho refuses.

export type ZohoEntity = {
  slug: string;
  name: string;
  organizationId: string;
  clientId: string | null;
  clientSecret: string | null;
  refreshToken: string | null;
  canPost: boolean;
  scopes: string | null;
  relationship: string | null;
  isActive: boolean;
  note: string | null;
};

/** The founder's own books — the entity everything defaulted to before this. */
export const DEFAULT_ENTITY = "parveen";

type Row = {
  slug: string; name: string; organization_id: string;
  client_id: string | null; client_secret: string | null; refresh_token: string | null;
  can_post: boolean; scopes: string | null; relationship: string | null;
  is_active: boolean; note: string | null;
};

const shape = (r: Row): ZohoEntity => ({
  slug: r.slug, name: r.name, organizationId: r.organization_id,
  clientId: r.client_id, clientSecret: r.client_secret, refreshToken: r.refresh_token,
  canPost: r.can_post, scopes: r.scopes, relationship: r.relationship,
  isActive: r.is_active, note: r.note,
});

/** Every set of books the desk can work on, the founder's first. */
export async function listEntities(): Promise<ZohoEntity[]> {
  const svc = createServiceClient();
  const { data } = await svc
    .from("zoho_entities")
    .select("slug, name, organization_id, client_id, client_secret, refresh_token, can_post, scopes, relationship, is_active, note")
    .eq("is_active", true)
    .order("relationship", { ascending: true })
    .order("name", { ascending: true });
  const rows = ((data ?? []) as Row[]).map(shape);
  rows.sort((a, b) => (a.slug === DEFAULT_ENTITY ? -1 : b.slug === DEFAULT_ENTITY ? 1 : 0));
  return rows;
}

export async function getEntity(slug?: string | null): Promise<ZohoEntity | null> {
  const want = (slug || DEFAULT_ENTITY).trim();
  const svc = createServiceClient();
  const { data } = await svc
    .from("zoho_entities")
    .select("slug, name, organization_id, client_id, client_secret, refresh_token, can_post, scopes, relationship, is_active, note")
    .eq("slug", want)
    .maybeSingle();
  return data ? shape(data as Row) : null;
}

/**
 * The credential to use for an entity: its own if it has one, otherwise the
 * portal-wide secrets. Returns null when nothing is configured, so callers can
 * say "not connected" rather than throwing halfway through a page.
 */
export async function credentialFor(entity: ZohoEntity): Promise<
  { clientId: string; clientSecret: string; refreshToken: string; organizationId: string } | null
> {
  const clientId = entity.clientId ?? (await getSecret("ZOHO_CLIENT_ID"));
  const clientSecret = entity.clientSecret ?? (await getSecret("ZOHO_CLIENT_SECRET"));
  const refreshToken = entity.refreshToken ?? (await getSecret("ZOHO_REFRESH_TOKEN"));
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken, organizationId: entity.organizationId };
}

/**
 * Stop a write before it starts. Zoho would refuse a read-only credential
 * anyway, but it would refuse it after the desk had already told someone the
 * entry was approved — and that is exactly the lie the approval gate exists to
 * prevent.
 */
export async function assertMayPost(slug?: string | null): Promise<ZohoEntity> {
  const entity = await getEntity(slug);
  if (!entity) throw new Error("That set of books is not connected.");
  if (!entity.canPost) {
    throw new Error(
      `${entity.name}'s books are connected READ-ONLY, so nothing can be posted to them from here. ` +
      `Reading, reports and the tax working all still work. To allow posting, that credential has to be ` +
      `re-created in ${entity.name}'s own Zoho with write scopes — which is their decision, not ours.`,
    );
  }
  return entity;
}
