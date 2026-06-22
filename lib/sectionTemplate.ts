import { createServiceClient } from "@/lib/supabase/service";

// Standard "sections" (topic_groups) are uniform across EVERY topic, subject and
// course. The template is the master list of section names; helpers keep every
// topic in sync with it. Stored in site_settings.topic_group_template (JSON).

export async function getSectionTemplate(): Promise<string[]> {
  const svc = createServiceClient();
  const { data } = await svc.from("site_settings").select("value").eq("key", "topic_group_template").maybeSingle();
  try {
    const a = JSON.parse((data?.value as string) ?? "[]");
    return Array.isArray(a) ? a.map((x) => String(x)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

async function saveTemplate(names: string[]): Promise<void> {
  const svc = createServiceClient();
  await svc.from("site_settings").upsert({ key: "topic_group_template", value: JSON.stringify(names) }, { onConflict: "key" });
}

// Create any missing template sections on ONE topic (used when a topic is born).
export async function ensureGroupsForTopic(topicId: string): Promise<void> {
  const svc = createServiceClient();
  const tmpl = await getSectionTemplate();
  if (!tmpl.length || !topicId) return;
  const { data: existing } = await svc.from("topic_groups").select("name").eq("topic_id", topicId);
  const have = new Set((existing ?? []).map((g) => g.name as string));
  const rows = tmpl.map((name, i) => ({ name, i })).filter((r) => !have.has(r.name)).map((r) => ({ topic_id: topicId, name: r.name, order_index: r.i }));
  if (rows.length) await svc.from("topic_groups").insert(rows);
}

// Make every regular topic match the template (the "apply to all" backfill).
export async function applyTemplateToAllTopics(): Promise<void> {
  const svc = createServiceClient();
  const tmpl = await getSectionTemplate();
  if (!tmpl.length) return;
  const { data: topics } = await svc.from("topics").select("id").eq("is_combined", false);
  const { data: groups } = await svc.from("topic_groups").select("topic_id, name");
  const have = new Set((groups ?? []).map((g) => `${g.topic_id}|${g.name}`));
  const rows: { topic_id: string; name: string; order_index: number }[] = [];
  for (const t of topics ?? []) for (let i = 0; i < tmpl.length; i++) if (!have.has(`${t.id}|${tmpl[i]}`)) rows.push({ topic_id: t.id as string, name: tmpl[i], order_index: i });
  // chunk inserts to stay well under limits
  for (let k = 0; k < rows.length; k += 500) await svc.from("topic_groups").insert(rows.slice(k, k + 500));
}

// Add a section to the template + every topic. Returns false if it already exists.
export async function addSectionEverywhere(name: string): Promise<void> {
  const tmpl = await getSectionTemplate();
  if (!tmpl.includes(name)) await saveTemplate([...tmpl, name]);
  await applyTemplateToAllTopics();
}

export async function renameSectionEverywhere(oldName: string, newName: string): Promise<void> {
  if (!oldName || !newName || oldName === newName) return;
  const svc = createServiceClient();
  await svc.from("topic_groups").update({ name: newName }).eq("name", oldName);
  const tmpl = await getSectionTemplate();
  await saveTemplate(tmpl.map((n) => (n === oldName ? newName : n)));
}

export async function deleteSectionEverywhere(name: string): Promise<void> {
  if (!name) return;
  const svc = createServiceClient();
  await svc.from("topic_groups").delete().eq("name", name);
  const tmpl = await getSectionTemplate();
  await saveTemplate(tmpl.filter((n) => n !== name));
}
