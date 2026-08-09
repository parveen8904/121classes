import { NextResponse, type NextRequest } from "next/server";
import { currentStaff, staffHome } from "@/lib/adminAccess";

// WHERE THIS PERSON'S WORK IS.
//
// The login form cannot answer that — permissions live on the profile, which
// the browser must not be trusted to read. So it sends everyone here and the
// server decides: a warehouse packer goes to the warehouse, a student goes to
// their dashboard, and nobody lands on a page built for somebody else's job.
export async function GET(req: NextRequest) {
  const staff = await currentStaff();
  const home = staffHome(staff) ?? "/dashboard";
  return NextResponse.redirect(new URL(home, req.url));
}
