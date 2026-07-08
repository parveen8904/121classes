import { redirect } from "next/navigation";

// The old manual "Downloadable classes" page is superseded by the automatic
// Offline downloads pipeline — forward anyone who lands here.
export default function ProtectedClassesPage() {
  redirect("/admin/offline");
}
