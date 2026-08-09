import { createServiceClient } from "@/lib/supabase/service";
import { sendWhatsAppText, sendEmail, emailShell } from "@/lib/notify";

// GET THE ANSWER TO THEM, WHATEVER CHANNEL IS STILL OPEN.
//
// WhatsApp carries a free-form reply for 24 hours after the student writes, and
// not a minute longer. Meta refuses everything after that, so an answer written
// at hour 25 is thrown away — and until now it was thrown away in silence.
//
// Two students missed that window by less than two hours: one who could not
// find the case studies, and one whose classes were not appearing. Both are
// registered here, with an email address on file. There was never any reason
// for them to hear nothing.
//
// So WhatsApp is tried first, and when it will not go the same words are sent
// by email. The result says which door opened, so the record is honest about
// how the student was actually reached.

export type Reached = { via: "whatsapp" | "email" | "none"; to: string | null };

/** Last ten digits, so 919810012345 and 9810012345 are the same person. */
function tail(phone: string): string {
  return (phone ?? "").replace(/\D/g, "").slice(-10);
}

/**
 * Reply to a student who wrote in on WhatsApp.
 *
 * `subject` is used only if it has to go by email, where a message with no
 * subject line reads like spam.
 */
export async function reachStudent(
  phone: string,
  text: string,
  subject = "A reply from CA Parveen Sharma Classes",
): Promise<Reached> {
  if (await sendWhatsAppText(phone, text)) return { via: "whatsapp", to: phone };

  // WhatsApp is shut. Do we know who this is?
  const digits = tail(phone);
  if (digits.length !== 10) return { via: "none", to: null };

  try {
    const { data } = await createServiceClient()
      .from("profiles")
      .select("email, full_name")
      .ilike("phone", `%${digits}`)
      .limit(1)
      .maybeSingle();

    const email = (data?.email as string | null) ?? null;
    if (!email) return { via: "none", to: null };

    const name = (data?.full_name as string | null) ?? "";
    const greeting = name ? `<p>Dear ${name.split(" ")[0]},</p>` : "";
    const ok = await sendEmail(
      email,
      subject,
      emailShell(subject, `${greeting}<p>${text.replace(/\n/g, "<br/>")}</p>`),
    );
    return ok ? { via: "email", to: email } : { via: "none", to: null };
  } catch {
    return { via: "none", to: null };
  }
}
