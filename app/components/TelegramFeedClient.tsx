"use client";

import { useEffect, useRef } from "react";

// Renders Telegram's official post embeds (auto-resizing iframes) for each post id.
export default function TelegramFeedClient({ username, ids }: { username: string; ids: number[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = "";
    for (const id of ids) {
      const s = document.createElement("script");
      s.async = true;
      s.src = "https://telegram.org/js/telegram-widget.js?22";
      s.setAttribute("data-telegram-post", `${username}/${id}`);
      s.setAttribute("data-width", "100%");
      s.setAttribute("data-dark", "1");
      el.appendChild(s);
    }
  }, [username, ids]);

  return <div ref={ref} style={{ display: "grid", gap: 8 }} />;
}
