"use client";

import { useState } from "react";

// Destination folders. Fifteen tick-boxes is a lot to re-read every time a
// post is written, and the founder posts to a handful of fixed mixes —
// personal, CA official, long-form, short, video. Clicking a folder ticks its
// channels; clicking it again unticks them. Nothing is auto-posted by the
// folder itself: it only sets the boxes, so what goes where is still visible
// before saving.

export type Folder = { id: string; name: string; icon: string | null; channels: string[] };

export default function ChannelFolders({
  folders,
  formId,
}: {
  folders: Folder[];
  formId?: string;
}) {
  const [active, setActive] = useState<string | null>(null);

  function apply(f: Folder) {
    const form = (formId ? document.getElementById(formId) : null) as HTMLFormElement | null;
    const scope: ParentNode = form ?? document;
    const turnOn = active !== f.id;
    for (const name of f.channels) {
      const box = scope.querySelector<HTMLInputElement>(`input[type="checkbox"][name="${name}"]`);
      if (box) box.checked = turnOn;
    }
    setActive(turnOn ? f.id : null);
  }

  if (!folders.length) return null;

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
      <span className="muted" style={{ fontSize: ".85rem", alignSelf: "center" }}>Folders:</span>
      {folders.map((f) => (
        <button
          key={f.id}
          type="button"
          className={active === f.id ? "btn small" : "btn small secondary"}
          onClick={() => apply(f)}
          title={f.channels.length ? `${f.channels.length} channels` : "No channels in this folder yet"}
        >
          {f.icon ? `${f.icon} ` : ""}{f.name}
        </button>
      ))}
    </div>
  );
}
