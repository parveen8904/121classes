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
  const url = (data?.value as string) || "";

  // A custom uploaded logo is shown as-is.
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="121 CA Classes" className="brand-logo" />;
  }

  // Built-in logo: light-text version on dark backgrounds, dark-text on light.
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-121-light.png" alt="121 CA Classes" className="brand-logo logo-on-dark" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-121.png" alt="121 CA Classes" className="brand-logo logo-on-light" />
    </>
  );
}
