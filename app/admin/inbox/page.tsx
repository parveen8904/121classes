import { redirect } from "next/navigation";

// THE INBOX IS GONE. There is one doubt report.
//
// Doubts used to be worked in an inbox and READ in a report, so the same
// student appeared in two places with two different counts — the admin home
// showed "5 open doubts" from one table and "8 open questions" from another,
// and both led here. Since doubts are answered automatically now, an inbox is a
// second queue for work that has already been done.
//
// The report shows what is still waiting, oldest first, and that is the only
// list anybody needs. This route stays so that old links and bookmarks land
// somewhere sensible instead of a missing page.
export default function InboxRedirect() {
  redirect("/admin/doubt-log");
}
