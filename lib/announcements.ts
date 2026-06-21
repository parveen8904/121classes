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
