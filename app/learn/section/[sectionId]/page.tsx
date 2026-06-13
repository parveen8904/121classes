import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import DiscussionSection from "./DiscussionSection";
import McqSection from "./McqSection";
import SubjectiveSection from "./SubjectiveSection";

export const dynamic = "force-dynamic";

// One route, dispatched by section type. RLS only returns the section if the
// student may access it (free or subscribed) — locked ones 404 back to topic.
export default async function SectionPage({ params }: { params: { sectionId: string } }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/learn/section/${params.sectionId}`);

  const { data: section } = await supabase
    .from("sections")
    .select("id, title, type, topic_id")
    .eq("id", params.sectionId)
    .maybeSingle();
  if (!section) notFound();

  if (section.type === "mcq_test") return <McqSection section={section} />;
  if (section.type === "subjective_test") return <SubjectiveSection section={section} />;

  if (section.type === "discussion") {
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
    return (
      <DiscussionSection section={section} userId={user.id} isAdmin={profile?.role === "admin"} />
    );
  }

  // Any other section type lives on the topic page.
  redirect(`/learn/topic/${section.topic_id}`);
}
