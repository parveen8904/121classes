import { redirect } from "next/navigation";

// Visitors and usage now live on the health page — one place for "how is the
// site doing", per the founder. This keeps old links and bookmarks working.
export default async function AnalyticsMoved(props: { searchParams: Promise<{ days?: string }> }) {
  const { days } = await props.searchParams;
  redirect(`/admin/health${days ? `?days=${days}` : ""}`);
}
