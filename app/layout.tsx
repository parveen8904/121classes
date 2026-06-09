import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "121 Coaching — Learning Portal",
  description:
    "Personalized 1-to-1 classes, coaching, live sessions and AI-assisted learning for CA students.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
