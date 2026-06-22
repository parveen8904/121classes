import type { MetadataRoute } from "next";

// Web App Manifest — makes the site installable as a PWA (home screen / desktop).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CA Parveen Sharma",
    short_name: "CA Parveen Sharma",
    description:
      "Personalized, AI-enabled CA coaching by CA Parveen Sharma — classes, tests, notes and doubt-solving.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#0c1413",
    theme_color: "#0d9488",
    icons: [
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
