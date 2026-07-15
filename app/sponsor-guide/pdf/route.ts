import { NextResponse } from "next/server";
import { buildSponsorGuidePdf } from "@/lib/sponsorGuide";

export const dynamic = "force-dynamic";

// Public download of the Sponsor Guide PDF.
export async function GET() {
  const pdf = await buildSponsorGuidePdf();
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'inline; filename="Sponsor-a-Student-Guide.pdf"',
      "cache-control": "public, max-age=3600",
    },
  });
}
