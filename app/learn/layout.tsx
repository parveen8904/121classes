import { redirect } from "next/navigation";
import PortalHeader from "@/app/components/PortalHeader";
import PortalFooter from "@/app/components/PortalFooter";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function LearnLayout({ children }: { children: React.ReactNode }) {
  // Mandatory profile completion: a student must have set their phone, level and
  // target attempt before entering the learn area. Incomplete → back to the
  // dashboard wizard. (Admins/faculty and sponsors are exempt.)
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: p } = await supabase
      .from("profiles")
      .select("role, account_type, target_attempt, phone")
      .eq("id", user.id)
      .maybeSingle();
    const isStaff = p?.role === "admin" || p?.role === "faculty";
    const phoneOk = ((p?.phone as string | null) ?? "").replace(/\D/g, "").length >= 10;
    if (!isStaff && p?.account_type !== "sponsor" && (!p?.target_attempt || !phoneOk)) {
      redirect("/dashboard");
    }
  }
  return (
    <>
      <PortalHeader />
      {children}
      <PortalFooter />
    </>
  );
}
