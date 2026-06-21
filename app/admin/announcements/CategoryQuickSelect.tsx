"use client";

import { useRef } from "react";
import { ANNOUNCEMENT_KINDS } from "@/lib/announcements";

// Always-visible inline category picker on each announcement row. Changing it
// saves immediately, so the founder sets the right category (Student update /
// Industry / Macro / Amendment) BEFORE publishing — no need to open the editor.
export default function CategoryQuickSelect({
  id,
  value,
  action,
}: {
  id: string;
  value: string;
  action: (fd: FormData) => void | Promise<void>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={action} style={{ display: "inline" }}>
      <input type="hidden" name="id" value={id} />
      <select
        name="kind"
        defaultValue={value}
        onChange={() => formRef.current?.requestSubmit()}
        style={{ fontSize: ".82rem", padding: "3px 6px", borderRadius: 6 }}
        aria-label="Category"
      >
        {ANNOUNCEMENT_KINDS.map((k) => (
          <option key={k.value} value={k.value}>{k.label}</option>
        ))}
      </select>
    </form>
  );
}
