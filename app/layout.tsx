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
import PushRegister from "./components/PushRegister";
import { sameAsFrom, orgNode, personNode, websiteNode } from "@/lib/entity";

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
      // founder_photo joins this list because a Knowledge Panel is built around
      // a picture of the person as much as around the facts — Google will not
      // show one it has no image for.
      .in("key", ["support_whatsapp", "support_phone", "support_telegram", "whatsapp_faculty", "support_youtube", "support_instagram", "support_twitter", "support_facebook", "google_site_verification", "founder_photo"]);
    return Object.fromEntries((data ?? []).map((r) => [r.key, r.value as string | null]));
  },
  ["layout-support-links"],
  { revalidate: 300 },
);

// Google Search Console verification without touching DNS.
//
// The DNS route kept failing because three different tokens are involved — the
// one Search Console is asking for, and two older ones already in the zone at
// GoDaddy. This meta tag is checked by Google on the homepage instead: paste
// the token in Admin → Site and it appears within a minute, no propagation, no
// registrar, and it cannot disturb the SPF or email records.
export async function generateMetadata(): Promise<Metadata> {
  const links = await getSupportLinks();
  const token = (links as Record<string, string | null>).google_site_verification;
  return token ? { ...baseMetadata, verification: { google: token } } : baseMetadata;
}

const baseMetadata: Metadata = {
  metadataBase: new URL("https://caparveensharma.com"),
  // "OFFICIAL SITE", BECAUSE IT IS.
  //
  // There is no badge Google grants for this — it is simply words in the title
  // tag, which is the blue line a student clicks. The reason to say it is that
  // resellers rank on the same name: Zeroinfy advertises on it and Lecturewala
  // ranks organically for it. A student who does not know which of five results
  // is the teacher's own site is a student who may buy from somebody else.
  //
  // Two constraints. It must be TRUE, which it is; a site claiming to be
  // official when it is a reseller is exactly what Google penalises. And the
  // whole thing must stay under about sixty characters or Google truncates it
  // mid-word — this is 58.
  //
  // The homepage only. Inner pages keep the template, where the page's own
  // subject is what a searcher needs to see.
  title: {
    default: "CA Parveen Sharma — Official Site | AI-Enabled CA Coaching",
    template: "%s | CA Parveen Sharma",
  },
  // "Praveen" outranks "Parveen" in Search Console: 865 impressions against
  // 376. Students look for him with an r and it is not a typo to be corrected —
  // it is how a large share of them write the name. Saying it once, plainly and
  // truthfully, lets Google connect the two without any keyword stuffing.
  description:
    "The official site of CA Parveen Sharma (also written Praveen Sharma) — Financial Reporting for CA Final and Advanced Accounting for CA Inter. Live classes, day-by-day study plans, AI doubt-solving and ad-free lectures, taught by him.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "CA Parveen Sharma" },
  // NO CANONICAL HERE. THIS IS WHAT KEPT THE SITE OUT OF GOOGLE.
  //
  // Next.js hands a layout's `alternates` down to every page that does not set
  // its own, so this one line made /pricing, /courses, /books, /test-series and
  // forty other pages each declare the HOME PAGE as their canonical version —
  // every one of them telling Google "I am a copy of the home page, index that
  // instead". Search Console reported them exactly as that: "Alternate page
  // with proper canonical tag" and "Duplicate, Google chose different canonical
  // than user". The home page now sets its own in app/page.tsx, and every page
  // carries its own address. Never put a canonical on a layout.
  openGraph: {
    type: "website",
    url: "https://caparveensharma.com",
    siteName: "CA Parveen Sharma",
    title: "CA Parveen Sharma — Official Site",
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
// Two places, on purpose: localStorage is the primary, and a cookie is the
// fallback for when storage is blocked or cleared. Without the cookie a full
// page load fell back to the system setting, so following a plain link into a
// page loaded it dark while the rest of the session stayed light.
const themeScript = `(function(){var t;try{t=localStorage.getItem('theme');}catch(e){}if(!t){var m=document.cookie.match(/(?:^|; )theme=(light|dark)/);if(m)t=m[1];}if(!t){try{t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}catch(e){t='dark';}}document.documentElement.setAttribute('data-theme',t);})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const links = await getSupportLinks();
  const m = new Map(Object.entries(links as Record<string, string | null>));
  // Everything Google needs to decide that the YouTube channel, the Instagram
  // account, the older Aldine site and this portal are one man — defined once in
  // lib/entity.ts so no page can describe him differently.
  const sameAs = sameAsFrom(m);
  const founderPhoto = m.get("founder_photo") || undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify({
            "@context": "https://schema.org",
            "@graph": [
              websiteNode(),
              orgNode({ sameAs }),
              personNode({ sameAs, image: founderPhoto }),
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
        <PushRegister />
      </body>
    </html>
  );
}
