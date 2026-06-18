"use server";

import { createClient } from "@/lib/supabase/server";

// Save the student's inbox folders + label assignments server-side (so they sync
// across devices). Safe before the table exists — errors are ignored.
export async function saveInboxPrefs(folders: string[], labels: Record<string, string>): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  try {
    await supabase
      .from("inbox_prefs")
      .upsert({ user_id: user.id, folders, labels, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  } catch {
    /* table not created yet — falls back to device storage */
  }
}
