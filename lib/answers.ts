import { createServiceClient } from "@/lib/supabase/service";

// Suggested answers are generated ONCE (when a test is drafted) and stored in
// site_settings (no migration needed), then served forever — no further AI use.
//   mcqx:<questionId>  -> JSON { wc: whyCorrect, ww: [whyEachOption] }
//   subjx:<questionId> -> model answer text

const mcqKey = (id: string) => `mcqx:${id}`;
const subjKey = (id: string) => `subjx:${id}`;

export type McqExplain = { wc: string; ww: string[] };

export async function saveMcqExplanation(id: string, wc: string, ww: string[]): Promise<void> {
  await createServiceClient()
    .from("site_settings")
    .upsert({ key: mcqKey(id), value: JSON.stringify({ wc, ww }) }, { onConflict: "key" });
}

export async function saveSubjModelAnswer(id: string, text: string): Promise<void> {
  if (!text) return;
  await createServiceClient()
    .from("site_settings")
    .upsert({ key: subjKey(id), value: text }, { onConflict: "key" });
}

export async function getMcqExplanations(ids: string[]): Promise<Map<string, McqExplain>> {
  const out = new Map<string, McqExplain>();
  if (!ids.length) return out;
  const { data } = await createServiceClient()
    .from("site_settings")
    .select("key, value")
    .in("key", ids.map(mcqKey));
  for (const r of data ?? []) {
    try {
      out.set((r.key as string).slice(5), JSON.parse(r.value as string));
    } catch {
      /* skip bad */
    }
  }
  return out;
}

export async function getSubjModelAnswers(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!ids.length) return out;
  const { data } = await createServiceClient()
    .from("site_settings")
    .select("key, value")
    .in("key", ids.map(subjKey));
  for (const r of data ?? []) out.set((r.key as string).slice(6), r.value as string);
  return out;
}
