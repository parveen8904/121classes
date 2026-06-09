import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "121 CA Classes — 1-to-1 Classes, Live Coaching & AI Learning",
  description:
    "Personalized 1-to-1 classes, live coaching, ad-free recorded lectures and AI-assisted learning for CA students in India.",
};

// Applies the saved/system theme before paint to avoid a flash of the wrong theme.
const themeScript = `try{var t=localStorage.getItem('theme')||(window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
