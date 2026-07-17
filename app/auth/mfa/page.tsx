import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MfaChallenge from "./MfaChallenge";

export const dynamic = "force-dynamic";
export const metadata = { title: "Two-factor check — CA Parveen Sharma" };

export default async function MfaPage(props: { searchParams: Promise<{ next?: string }> }) {
  const searchParams = await props.searchParams;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/auth/mfa");
  const next = searchParams.next && searchParams.next.startsWith("/") ? searchParams.next : "/admin";
  // MFA is optional now (switched off 2026-07-14). If this account has no
  // enrolled authenticator — the normal case — there is nothing to challenge:
  // go straight through instead of demanding a code or forcing setup.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const hasTotp = (factors?.totp ?? []).some((f) => f.status === "verified");
  if (!hasTotp) redirect(next);
  return <MfaChallenge next={next} />;
}
