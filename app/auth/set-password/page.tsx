import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SetPasswordForm from "./SetPasswordForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set your password — 121 CA Classes" };

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <SetPasswordForm next={searchParams.next || "/dashboard"} />;
}
