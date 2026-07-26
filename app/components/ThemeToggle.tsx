"use client";

import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");

  useEffect(() => {
    const current = (document.documentElement.getAttribute("data-theme") as
      | "light"
      | "dark") || "dark";
    setTheme(current);
  }, []);

  function toggle() {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch {}
    // Belt and braces: a cookie survives storage being blocked, and is what a
    // full page load reads when localStorage comes back empty.
    try {
      document.cookie = `theme=${next}; path=/; max-age=31536000; samesite=lax`;
    } catch {}
    setTheme(next);
  }

  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={toggle}
      aria-label="Toggle light and dark mode"
    >
      {theme === "light" ? "☀️" : "🌙"}
    </button>
  );
}
