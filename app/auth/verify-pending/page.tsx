import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import VerifyPending from "./VerifyPending";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verify your email — CA Parveen Sharma" };

export default async function VerifyPendingPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (user.email_confirmed_at || user.phone_confirmed_at) redirect("/dashboard");
  return <VerifyPending email={user.email ?? ""} />;
}
