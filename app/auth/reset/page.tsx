import ResetForm from "./reset-form";

// Render at request time (this page relies on the recovery session, not a build prerender).
export const dynamic = "force-dynamic";

export default function ResetPage() {
  return <ResetForm />;
}
