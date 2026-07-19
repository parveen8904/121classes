import type { Metadata, Viewport } from "next";
import SiteChrome from "./components/SiteChrome";
import SiteNav from "./components/SiteNav";
import SiteFooter from "./components/SiteFooter";
import { unstable_cache } from "next/cache";
import NextTopLoader from "nextjs-toploader";
import "./globals.css";
import { tryServiceClient } from "@/lib/supabase/service";
import FloatingSupport from "./components/FloatingSupport";
import RegisterSW from "./components/RegisterSW";
import InAppMode from "@/app/components/InAppMode";
import Tracker from "./components/Tracker";
import LeadPopup from "./components/LeadPopup";
import PageHelp from "./components/PageHelp";
import RatePrompt from "./components/RatePrompt";

// IMPORTANT: no force-dynamic and no cookie reads here. This layout wraps EVERY
// page — anything dynamic in it disables caching for the whole site (which was
// why public pages took seconds to load). Auth-aware widgets detect the
// session client-side instead.

// Support links rarely change — cache them for 5 minutes so we don't hit the DB
// on every single page load (this runs in the layout, i.e. everywhere).
const getSupportLinks = unstable_cache(
  async () => {
    const svc = tryServiceClient();
    if (!svc) return {};
    const { data } = await svc
      .from("site_settings")
      .select("key, value")
      .in("key", ["support_whatsapp", "support_phone", "support_telegram", "whatsapp_faculty", "support_youtube", "support_instagram", "support_twitter", "support_facebook"]);
    return Object.fromEntries((data ?? []).map((r) => [r.key, r.value as string | null]));
  },
  ["layout-support-links"],
  { revalidate: 300 },
);

export const metadata: Metadata = {
  metadataBase: new URL("https://caparveensharma.com"),
  title: {
    default: "CA Parveen Sharma — AI-Enabled CA Coaching | caparveensharma.com",
    template: "%s | CA Parveen Sharma",
  },
  description:
    "Highly personalised, AI-enabled CA coaching that clears the clutter — top-notch, result-oriented 1-to-1 teaching, live classes and ad-free lectures for CA students in India.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "CA Parveen Sharma" },
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "https://caparveensharma.com",
    siteName: "CA Parveen Sharma",
    title: "CA Parveen Sharma — Personalised CA Coaching",
    description: "Advanced Accounting (CA Inter) & Financial Reporting (CA Final) by CA Parveen Sharma — classes, day-by-day study plans, AI doubt-solving, tests & amendments.",
    images: [{ url: "/icon-512.png", width: 512, height: 512, alt: "CA Parveen Sharma" }],
    locale: "en_IN",
  },
  twitter: {
    card: "summary",
    title: "CA Parveen Sharma — Personalised CA Coaching",
    description: "Advanced Accounting & Financial Reporting — personally mentored, AI-assisted CA preparation.",
    images: ["/icon-512.png"],
  },
  robots: { index: true, follow: true },
};

// Ensure mobile browsers render at device width (responsive layout).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0d9488",
};

// Applies the saved/system theme before paint to avoid a flash of the wrong theme.
const themeScript = `try{var t=localStorage.getItem('theme')||(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const links = await getSupportLinks();
  const m = new Map(Object.entries(links as Record<string, string | null>));
  // Social profiles strengthen the knowledge-graph link between the site and
  // the founder's established channels (E-E-A-T signal for Google).
  const sameAs = ["support_youtube", "support_instagram", "support_twitter", "support_facebook"]
    .map((k) => m.get(k))
    .filter((u): u is string => Boolean(u && u.startsWith("http")));

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify({
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "EducationalOrganization",
                "@id": "https://caparveensharma.com/#org",
                name: "CA Parveen Sharma — Personalised Learning",
                url: "https://caparveensharma.com",
                logo: "https://caparveensharma.com/icon-512.png",
                sameAs,
                founder: { "@id": "https://caparveensharma.com/#person" },
                address: { "@type": "PostalAddress", streetAddress: "W6 Sector 24, DLF Phase 3", addressLocality: "Gurugram", postalCode: "122010", addressCountry: "IN" },
              },
              {
                "@type": "Person",
                "@id": "https://caparveensharma.com/#person",
                name: "CA Parveen Sharma",
                jobTitle: "Chartered Accountant & Educator",
                description: "CA faculty with 36 years of teaching experience — Advanced Accounting (CA Inter) and Financial Reporting (CA Final).",
                url: "https://caparveensharma.com",
                sameAs,
                worksFor: { "@id": "https://caparveensharma.com/#org" },
              },
            ],
          }) }}
        />
      </head>
      <body>
        {/* Top progress bar shown on every page load / navigation */}
        <NextTopLoader color="#0d9488" height={4} showSpinner={true} shadow="0 0 8px #0d9488" />
        <SiteChrome nav={<SiteNav />} footer={<SiteFooter />}>{children}</SiteChrome>
        <FloatingSupport
          whatsapp={m.get("support_whatsapp")}
          phone={m.get("support_phone")}
          telegram={m.get("support_telegram")}
        />
        <RegisterSW />
        <InAppMode />
        {/* First-party page-view beacon (client-side; keeps the layout cacheable) */}
        <Tracker />
        {/* Lead capture on public marketing pages (client-side session check) */}
        <LeadPopup />
        {/* Floating per-page "?" help (bottom-left, page-aware) */}
        <PageHelp />
        {/* Play-Store rating ask — Android app only, invested users, happy pages */}
        <RatePrompt />
      </body>
    </html>
  );
}
