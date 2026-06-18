import { createClient } from "@/lib/supabase/server";

// Shows the uploaded brand logo (Admin → Site images → Brand logo) when set;
// otherwise falls back to the text wordmark so the site always looks complete.
export default async function Logo() {
  const supabase = createClient();
  const { data } = await supabase
    .from("site_settings")
    .select("value")
    .eq("key", "logo_url")
    .maybeSingle();
  const url = (data?.value as string) || "/logo-121.png";
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="121 CA Classes" className="brand-logo" />;
}
