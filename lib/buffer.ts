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

/** The X/Twitter channel to post to: explicit secret wins, else the first
 * Twitter/X channel on the Buffer account. */
export async function bufferXChannelId(): Promise<string> {
  const explicit = (await getSecret("BUFFER_X_CHANNEL_ID")).trim();
  if (explicit) return explicit;
  const r = await gql(`query { channels { id name service } }`);
  if (!r.ok) return "";
  const channels = ((r.data as { channels?: { id: string; service?: string }[] })?.channels) ?? [];
  const x = channels.find((c) => /twitter|^x$/i.test(String(c.service ?? "")));
  return x?.id ?? "";
}

/** Queue one post on the X channel. `shareNow` posts immediately;
 * `addToQueue` uses Buffer's schedule slots. */
export async function bufferPostToX(text: string, mode: "shareNow" | "addToQueue" = "addToQueue"): Promise<{ ok: boolean; error?: string }> {
  const channelId = await bufferXChannelId();
  if (!channelId) return { ok: false, error: "No X channel found on the Buffer account" };
  const r = await gql(
    `mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        ... on PostActionSuccess { post { id } }
        ... on MutationError { message }
      }
    }`,
    { input: { text: text.slice(0, 275), channelId, schedulingType: "automatic", mode } },
  );
  if (!r.ok) return { ok: false, error: r.error };
  const out = (r.data as { createPost?: { post?: { id?: string }; message?: string } })?.createPost;
  if (out?.post?.id) return { ok: true };
  return { ok: false, error: out?.message ?? "Buffer did not accept the post" };
}
