import { redirect } from "next/navigation";

// A SHORT ADDRESS SOMEBODY CAN READ OUT.
//
// The contact card lives at /api/contact-card, which is a fine place for a link
// on a page and a terrible thing to put in a WhatsApp message or read down the
// phone. caparveensharma.com/save-number is the same card with an address a
// student can type.
export function GET() {
  redirect("/api/contact-card");
}
