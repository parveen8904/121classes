import { createClient } from "@/lib/supabase/server";
import ResetForm from "./reset-form";

// Render at request time (this page relies on the recovery session, not a build prerender).
export const dynamic = "force-dynamic";

export default async function ResetPage() {
  const supabase = createClient();
  const { data } = await supabase.from("site_settings").select("value").eq("key", "logo_url").maybeSingle();
  const logoUrl = (data?.value as string) || "/logo-121.png";
  return <ResetForm logoUrl={logoUrl} />;
}
