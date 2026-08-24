import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MockInterview from "./MockInterview";

export const dynamic = "force-dynamic";
export const metadata = {
  // Its own address, so it is not read as a copy of the home page.
  alternates: { canonical: "/career/interview" }, title: "AI Mock Interview" };

export default async function InterviewPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/career/interview");
  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 760 }}>
      <div className="learn-hero" style={{ marginBottom: 18 }}>
        <span className="badge">🎤 Mock Interview</span>
        <h1>AI mock interview</h1>
        <p className="meta">Practise a realistic CA articleship/job interview. You&apos;ll get feedback after each answer and a final assessment.</p>
      </div>
      <MockInterview />
    </section>
  );
}
