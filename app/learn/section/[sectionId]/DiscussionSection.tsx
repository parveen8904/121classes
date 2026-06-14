import Link from "next/link";
import DiscussionBoard from "./DiscussionBoard";

export default async function DiscussionSection({
  section,
  userId,
  isAdmin,
}: {
  section: { id: string; title: string; topic_id: string };
  userId: string;
  isAdmin: boolean;
}) {
  return (
    <main>
      <section className="container" style={{ paddingTop: 30, paddingBottom: 60, maxWidth: 860 }}>
        <p className="crumb">
          <Link href={`/learn/topic/${section.topic_id}`}>← Back to topic</Link>
        </p>
        <div className="learn-hero">
          <span className="badge">🗣️ Discussion</span>
          <h1>{section.title}</h1>
          <p className="meta">Ask anything — staff and fellow students reply.</p>
        </div>
        <div style={{ marginTop: 20 }}>
          <DiscussionBoard
            sectionId={section.id}
            userId={userId}
            isAdmin={isAdmin}
            returnPath={`/learn/section/${section.id}`}
          />
        </div>
      </section>
    </main>
  );
}
