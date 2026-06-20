import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import LoginForm from "./login-form";

// Render at request time (never statically pre-render this auth page at build).
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const supabase = createClient();
  const { data } = await supabase.from("site_settings").select("value").eq("key", "logo_url").maybeSingle();
  const logoUrl = (data?.value as string) || "/logo-121.png";
  return (
    <Suspense fallback={null}>
      <LoginForm logoUrl={logoUrl} />
    </Suspense>
  );
}
