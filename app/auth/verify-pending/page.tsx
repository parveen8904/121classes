import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import VerifyPending from "./VerifyPending";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verify your email — 121 CA Classes" };

export default async function VerifyPendingPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (user.email_confirmed_at || user.phone_confirmed_at) redirect("/dashboard");
  const { data: lg } = await supabase.from("site_settings").select("value").eq("key", "logo_url").maybeSingle();
  const logoUrl = (lg?.value as string) || "/logo-121.png";
  return <VerifyPending email={user.email ?? ""} logoUrl={logoUrl} />;
}
