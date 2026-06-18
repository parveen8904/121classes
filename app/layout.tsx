import type { Metadata, Viewport } from "next";
import NextTopLoader from "nextjs-toploader";
import "./globals.css";
import { createClient } from "@/lib/supabase/server";
import FloatingSupport from "./components/FloatingSupport";
import RegisterSW from "./components/RegisterSW";
import AskMe from "./components/AskMe";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "121 CA Classes — Highly Personalized, AI-Enabled CA Coaching",
  description:
    "Highly personalized, AI-enabled CA coaching that clears the clutter — top-notch, result-oriented 1-to-1 teaching, live classes and ad-free lectures for CA students in India.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "CA Classes" },
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
  const [{ data: settings }, { data: auth }] = await Promise.all([
    supabase
      .from("site_settings")
      .select("key, value")
      .in("key", ["support_whatsapp", "support_phone", "support_telegram"]),
    supabase.auth.getUser(),
  ]);
  const m = new Map((settings ?? []).map((r) => [r.key, r.value as string | null]));
  const signedIn = !!auth?.user;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        {/* Top progress bar shown on every page load / navigation */}
        <NextTopLoader color="#0d9488" height={3} showSpinner={false} shadow="0 0 8px #0d9488" />
        {children}
        <FloatingSupport
          whatsapp={m.get("support_whatsapp")}
          phone={m.get("support_phone")}
          telegram={m.get("support_telegram")}
        />
        <AskMe signedIn={signedIn} />
        <RegisterSW />
      </body>
    </html>
  );
}
