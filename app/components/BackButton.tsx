"use client";

import { usePathname, useRouter } from "next/navigation";

// Back button shown in the portal header — available on every signed-in page
// EXCEPT the dashboard: that's the portal's home (and the app's start screen),
// so there is nothing to go back to and the brand deserves the space.
export default function BackButton() {
  const router = useRouter();
  const pathname = usePathname();
  if (pathname === "/dashboard") return null;
  return (
    <button
      type="button"
      onClick={() => router.back()}
      aria-label="Go back"
      className="portal-back"
      style={{ border: "1px solid var(--border)", background: "var(--bg-soft)", cursor: "pointer", font: "inherit", color: "var(--muted)", borderRadius: 8, padding: "4px 10px", lineHeight: 1.2 }}
    >
      ← Back
    </button>
  );
}
