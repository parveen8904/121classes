import { redirect } from "next/navigation";

// The email report merged into Admin → Emails on 19 August 2026 — two email
// tiles meant nobody knew which one to open. Everything it showed lives on
// there: Mailgun's delivered/failed counts, the verdict line, and the
// per-kind sent/not-sent list. This stub keeps old links and bookmarks alive.
export default async function EmailReportMoved(props: { searchParams: Promise<{ days?: string }> }) {
  const { days } = await props.searchParams;
  redirect(days ? `/admin/emails?days=${encodeURIComponent(days)}` : "/admin/emails?days=7");
}
