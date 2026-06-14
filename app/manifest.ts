import type { MetadataRoute } from "next";

// Web App Manifest — makes the site installable as a PWA (home screen / desktop).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "121 CA Classes",
    short_name: "CA Classes",
    description:
      "Personalized, AI-enabled CA coaching by CA Parveen Sharma — classes, tests, notes and doubt-solving.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#0c1413",
    theme_color: "#0d9488",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
