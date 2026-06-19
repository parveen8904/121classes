"use client";

import { useRouter } from "next/navigation";

// Back button shown in the portal header — available on every signed-in page.
export default function BackButton() {
  const router = useRouter();
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
