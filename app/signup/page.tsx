import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SignupForm from "./SignupForm";

export const dynamic = "force-dynamic";
export const metadata = {
  // Its own address, so it is not read as a copy of the home page.
  alternates: { canonical: "/signup" }, title: "Create account — CA Parveen Sharma" };

export default async function SignupPage() {
  // Already signed in? Nothing to create — send them home.
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect("/auth/home");
  return <SignupForm />;
}
