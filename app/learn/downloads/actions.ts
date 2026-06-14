"use server";

import { createClient } from "@/lib/supabase/server";

// Release the AES key for an encrypted class — only to a logged-in student who
// passes has_subject_access (enforced inside get_protected_class_key). Called by
// the desktop app's Downloads page (same-origin, cookie session).
export async function getOfflineKey(id: string): Promise<{ key: string } | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: key, error } = await supabase.rpc("get_protected_class_key", { p_id: id });
  if (error || !key) return null;
  return { key: key as string };
}
