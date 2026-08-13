import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// DRAFTING IS OFF. HE WRITES THE PAPERS.
//
// "I will always upload my paper and my keys." That settles it: there is no
// case left in which a machine should be setting a mock paper for his students,
// so the whole pipeline is gone rather than guarded.
//
// It had already done real harm. Mock paper 1 held his own question paper and
// his own answer key as PDFs, and the drafter wrote its own Part I over the top
// of the key — papers 2 and 3 escaped only because they happened to be approved,
// which the queue skipped. Every guard added on top of that was another rule to
// remember. Not running is the only rule that cannot be got wrong.
//
// The schedule is removed from vercel.json. This route stays and says so,
// because an hourly cron that 404s is noise in the logs, and a route that
// explains itself is worth more than one that simply vanished.
export async function GET() {
  return NextResponse.json({
    ok: true,
    drafting: "off",
    note: "Mock papers are written and uploaded by CA Parveen Sharma. Nothing is drafted.",
  });
}
