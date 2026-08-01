import { getSecret } from "@/lib/secrets";

// Buffer's GraphQL API (api.buffer.com, personal API key, Bearer auth).
// We use it for X/Twitter: the campaigns engine drafts the post, Buffer's
// queue publishes it. The founder's free Buffer plan covers this — no X
// developer keys needed at all.

const ENDPOINT = "https://api.buffer.com";

export async function bufferConfigured(): Promise<boolean> {
  return Boolean(await getSecret("BUFFER_API_KEY"));
}

async function gql(query: string, variables?: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const key = await getSecret("BUFFER_API_KEY");
  if (!key) return { ok: false, error: "Buffer API key not configured" };
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });
    const json = (await res.json()) as { data?: unknown; errors?: { message?: string }[] };
    if (!res.ok || json.errors?.length) {
      return { ok: false, error: json.errors?.[0]?.message ?? `HTTP ${res.status}` };
    }
    return { ok: true, data: json.data };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** The X/Twitter channel to post to: explicit secret wins, else discovered
 * live (channels are organization-scoped — shape verified against the real
 * API, not the docs). */
export async function bufferXChannelId(): Promise<string> {
  const explicit = (await getSecret("BUFFER_X_CHANNEL_ID")).trim();
  if (explicit) return explicit;
  const acct = await gql(`query { account { organizations { id } } }`);
  if (!acct.ok) return "";
  const orgId = (acct.data as { account?: { organizations?: { id: string }[] } })?.account?.organizations?.[0]?.id ?? "";
  if (!orgId) return "";
  const r = await gql(
    `query Channels($orgId: OrganizationId!) { channels(input: { organizationId: $orgId }) { id name service } }`,
    { orgId },
  );
  if (!r.ok) return "";
  const channels = ((r.data as { channels?: { id: string; service?: string }[] })?.channels) ?? [];
  const x = channels.find((c) => /twitter|^x$/i.test(String(c.service ?? "")));
  return x?.id ?? "";
}

/** Post to ANY connected Buffer channel. Instagram needs a picture — a
 * text-only Instagram post does not exist — so an image URL is passed for it;
 * X takes text alone. (Field shapes read from Buffer's own schema:
 * assets: [AssetInput], AssetInput.image: { url }.) */
export async function bufferPost(
  text: string,
  channelId: string,
  opts: { imageUrl?: string; mode?: "shareNow" | "addToQueue" } = {},
): Promise<{ ok: boolean; error?: string }> {
  if (!channelId) return { ok: false, error: "no Buffer channel id" };
  const input: Record<string, unknown> = {
    text: text.slice(0, 2000),
    channelId,
    schedulingType: "automatic",
    mode: opts.mode ?? "addToQueue",
  };
  if (opts.imageUrl) input.assets = [{ image: { url: opts.imageUrl } }];

  const r = await gql(
    `mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess { post { id } }
        ... on MutationError { message }
      }
    }`,
    { input },
  );
  if (!r.ok) return { ok: false, error: r.error };
  const out = (r.data as { createPost?: { post?: { id?: string }; message?: string } })?.createPost;
  if (out?.post?.id) return { ok: true };
  return { ok: false, error: out?.message ?? "Buffer did not accept the post" };
}

/** Queue one post on the X channel. `shareNow` posts immediately;
 * `addToQueue` uses Buffer's schedule slots. */
export async function bufferPostToX(text: string, mode: "shareNow" | "addToQueue" = "addToQueue"): Promise<{ ok: boolean; error?: string }> {
  const channelId = await bufferXChannelId();
  if (!channelId) return { ok: false, error: "No X channel found on the Buffer account" };
  return bufferPost(text.slice(0, 275), channelId, { mode });
}

/** The founder's PERSONAL Instagram (ca_parveen_sharma). It cannot go through
 * the Graph API: a Facebook Page may have only one Instagram professional
 * account linked, and the 33k page already holds the company one. Buffer is
 * the honest route for the second account. */
export async function bufferIgPersonalConfigured(): Promise<boolean> {
  return Boolean((await getSecret("BUFFER_API_KEY")) && (await getSecret("BUFFER_IG_CHANNEL_ID")));
}

export async function bufferPostToInstagram(
  text: string,
  imageUrl: string,
  mode: "shareNow" | "addToQueue" = "addToQueue",
): Promise<{ ok: boolean; error?: string }> {
  const channelId = (await getSecret("BUFFER_IG_CHANNEL_ID")).trim();
  if (!channelId) return { ok: false, error: "No personal Instagram channel set" };
  if (!imageUrl) return { ok: false, error: "Instagram needs a picture" };
  return bufferPost(text, channelId, { imageUrl, mode });
}
