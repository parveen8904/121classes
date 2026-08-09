import { redirect } from "next/navigation";

// One doubt report, not a hub of desks in front of it.
//
// This page listed the doubt inbox, the WhatsApp inbox and the doubt log side
// by side, each with its own count — three doors to the same question. The
// report answers "what is waiting and what went back" for every channel at
// once, so it is the door.
export default function MessagesRedirect() {
  redirect("/admin/doubt-log");
}
