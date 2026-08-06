import { createServiceClient } from "@/lib/supabase/service";

// Suggested answers are generated ONCE (when a test is drafted) and stored
// forever — no further AI use.
//   mcqx:<questionId>  -> JSON { wc: whyCorrect, ww: [whyEachOption] }
//   subjx:<questionId> -> model answer text
//
// These used to live in site_settings "because it needed no migration". 1,354
// rows later that table exceeded the API's 1,000-row ceiling, and every page
// reading settings unfiltered — the homepage, the plans page, the payment paths
// — was silently getting a partial table. Configuration and content now live
// apart (migration 0129).

const mcqKey = (id: string) => `mcqx:${id}`;
const subjKey = (id: string) => `subjx:${id}`;

export type McqExplain = { wc: string; ww: string[] };

export async function saveMcqExplanation(id: string, wc: string, ww: string[]): Promise<void> {
  await createServiceClient()
    .from("answer_explanations")
    .upsert({ key: mcqKey(id), value: JSON.stringify({ wc, ww }) }, { onConflict: "key" });
}

export async function saveSubjModelAnswer(id: string, text: string): Promise<void> {
  if (!text) return;
  await createServiceClient()
    .from("answer_explanations")
    .upsert({ key: subjKey(id), value: text }, { onConflict: "key" });
}

export async function getMcqExplanations(ids: string[]): Promise<Map<string, McqExplain>> {
  const out = new Map<string, McqExplain>();
  if (!ids.length) return out;
  const { data } = await createServiceClient()
    .from("answer_explanations")
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
    .from("answer_explanations")
    .select("key, value")
    .in("key", ids.map(subjKey));
  for (const r of data ?? []) out.set((r.key as string).slice(6), r.value as string);
  return out;
}
