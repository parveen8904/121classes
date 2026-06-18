import { createServiceClient } from "@/lib/supabase/service";

// Build the study-material context the AI is grounded on. Pulls active repository
// items (optionally biased to a subject), respects validity dates, and caps the
// total size so we stay within the model's context budget.
export async function getRepositoryContext(
  subjectId?: string | null,
  maxChars = 40000,
): Promise<string> {
  const svc = createServiceClient();
  const { data } = await svc
    .from("repository_items")
    .select("title, content, subject_id, valid_from, valid_to")
    .eq("is_active", true)
    .not("content", "is", null)
    .order("created_at", { ascending: false });

  const today = new Date().toISOString().slice(0, 10);
  const rows = (data ?? []).filter((r) => {
    if (!r.content) return false;
    if (r.valid_from && r.valid_from > today) return false;
    if (r.valid_to && r.valid_to < today) return false;
    return true;
  });

  // Subject-specific material first, then general (no subject), then the rest.
  rows.sort((a, b) => {
    const rank = (s: string | null) => (s === subjectId ? 0 : s ? 2 : 1);
    return rank(a.subject_id) - rank(b.subject_id);
  });

  let out = "";
  for (const r of rows) {
    const chunk = `\n\n### ${r.title}\n${r.content}`;
    if (out.length + chunk.length > maxChars) {
      out += chunk.slice(0, Math.max(0, maxChars - out.length));
      break;
    }
    out += chunk;
  }
  return out.trim();
}
