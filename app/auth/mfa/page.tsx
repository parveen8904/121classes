import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MfaChallenge from "./MfaChallenge";

export const dynamic = "force-dynamic";
export const metadata = { title: "Two-factor check — CA Parveen Sharma" };

export default async function MfaPage({ searchParams }: { searchParams: { next?: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/auth/mfa");
  const next = searchParams.next && searchParams.next.startsWith("/") ? searchParams.next : "/admin";
  return <MfaChallenge next={next} />;
}
