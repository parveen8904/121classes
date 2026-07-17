import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MfaEnroll from "./MfaEnroll";

export const dynamic = "force-dynamic";
export const metadata = { title: "Two-factor setup — CA Parveen Sharma" };

export default async function MfaSetupPage(props: { searchParams: Promise<{ required?: string }> }) {
  const searchParams = await props.searchParams;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/auth/mfa/setup");
  return <MfaEnroll required={searchParams.required === "1"} />;
}
