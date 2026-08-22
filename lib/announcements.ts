// Announcement categories — chosen from a dropdown in the admin section and
// shown as a labelled badge to students, so they know whether a post is an
// amendment, a general update, industry news, a macro note, etc.
export const ANNOUNCEMENT_KINDS = [
  { value: "student_corner", label: "Student update" },
  { value: "industry", label: "Industry news" },
  { value: "macro", label: "Macro / Economy" },
  { value: "amendment", label: "Amendment" },
  { value: "whats_new", label: "Update" },
] as const;

export const ANNOUNCEMENT_KIND_LABEL: Record<string, string> = Object.fromEntries(
  ANNOUNCEMENT_KINDS.map((k) => [k.value, k.label]),
);

// Friendly fallback if an older row has an unknown kind.
export function announcementKindLabel(kind: string): string {
  return ANNOUNCEMENT_KIND_LABEL[kind] ?? "Update";
}

// The href for an announcement's attached file, safe for a public page.
//   - an external link (Google Drive, any https) is used as-is (free, no login)
//   - an uploaded/secure file is served through the PUBLIC announcement proxy,
//     which only ever serves files attached to a PUBLISHED announcement.
// Empty string when there is no link.
export function announcementHref(a: { id: string; link_url?: string | null; title?: string | null }): string {
  const u = String(a.link_url ?? "").trim();
  if (!u) return "";
  // Hitlists are gated (login + WhatsApp number) — ALWAYS go through the file
  // route so the gate applies, even when the link is an external one.
  if (/hitlist/i.test(String(a.title ?? ""))) return `/api/announcement-file?a=${a.id}`;
  if (/^https?:\/\//.test(u)) return u;
  return `/api/announcement-file?a=${a.id}`;
}
