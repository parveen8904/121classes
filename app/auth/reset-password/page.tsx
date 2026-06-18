import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SetPasswordForm from "../set-password/SetPasswordForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set a new password — 121 CA Classes" };

// Reached from the password-reset email link: the recovery code is exchanged in
// /auth/callback, leaving a session here so the user can set a new password.
export default async function ResetPasswordPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <SetPasswordForm next="/dashboard" />;
}
