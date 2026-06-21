import type { Metadata, Viewport } from "next";
import { unstable_cache } from "next/cache";
import NextTopLoader from "nextjs-toploader";
import "./globals.css";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import FloatingSupport from "./components/FloatingSupport";
import RegisterSW from "./components/RegisterSW";
import AskMe from "./components/AskMe";

export const dynamic = "force-dynamic";

// Support links rarely change — cache them for 5 minutes so we don't hit the DB
// on every single page load (this runs in the layout, i.e. everywhere).
const getSupportLinks = unstable_cache(
  async () => {
    const { data } = await createServiceClient()
      .from("site_settings")
      .select("key, value")
      .in("key", ["support_whatsapp", "support_phone", "support_telegram", "whatsapp_faculty"]);
    return Object.fromEntries((data ?? []).map((r) => [r.key, r.value as string | null]));
  },
  ["layout-support-links"],
  { revalidate: 300 },
);

export const metadata: Metadata = {
  title: "CA Parveen Sharma — AI-Enabled CA Coaching | caparveensharma.com",
  description:
    "Highly personalized, AI-enabled CA coaching that clears the clutter — top-notch, result-oriented 1-to-1 teaching, live classes and ad-free lectures for CA students in India.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "CA Parveen Sharma" },
};

// Ensure mobile browsers render at device width (responsive layout).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0d9488",
};

// Applies the saved/system theme before paint to avoid a flash of the wrong theme.
const themeScript = `try{var t=localStorage.getItem('theme')||(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const [links, sessionRes] = await Promise.all([
    getSupportLinks(),
    // getSession reads the cookie locally (no network round-trip); it only
    // toggles the AskMe widget, so it doesn't need getUser's token validation.
    supabase.auth.getSession(),
  ]);
  const m = new Map(Object.entries(links as Record<string, string | null>));
  const signedIn = !!sessionRes.data.session;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {/* Top progress bar shown on every page load / navigation */}
        <NextTopLoader color="#0d9488" height={4} showSpinner={true} shadow="0 0 8px #0d9488" />
        {children}
        <FloatingSupport
          whatsapp={m.get("support_whatsapp")}
          phone={m.get("support_phone")}
          telegram={m.get("support_telegram")}
        />
        <AskMe signedIn={signedIn} facultyWhatsapp={m.get("whatsapp_faculty") ?? undefined} />
        <RegisterSW />
      </body>
    </html>
  );
}
