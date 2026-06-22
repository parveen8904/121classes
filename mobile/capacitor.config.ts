import type { CapacitorConfig } from "@capacitor/cli";

// CA Parveen Sharma — iOS (iPhone + iPad) & Android app.
// Phase 1: a native shell that loads the LIVE site (Mumbai-backed) starting at
// the dashboard, so it's login-first with no marketing pages. Phase 2 adds the
// native secure offline download/playback plugin (encrypted, link-safe).
const config: CapacitorConfig = {
  appId: "in.caclasses.app",
  appName: "CA Parveen Sharma",
  webDir: "www",
  server: {
    // Open straight at the dashboard (→ login if needed → dashboard). Same Mumbai
    // backend as the website and desktop app.
    url: "https://caparveensharma.com/dashboard",
    allowNavigation: [
      "caparveensharma.com",
      "*.caparveensharma.com",
      "*.supabase.co",
    ],
  },
  ios: {
    contentInset: "always",
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
