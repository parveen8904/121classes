import { createClient } from "@/lib/supabase/server";
import AdminHero from "../../_components/AdminHero";
import PostsManager from "./PostsManager";
import { updateAnnouncement, deleteAnnouncement, broadcastAnnouncement, bulkPublish, bulkUnpublish, bulkDelete } from "../actions";

export default async function AllPostsPage() {
  const supabase = createClient();
  const { data: items } = await supabase
    .from("announcements")
    .select("id, kind, title, body, link_url, is_published, broadcast_at, from_feed, published_at, created_at")
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  return (
    <section className="container" style={{ paddingTop: 30, paddingBottom: 60 }}>
      <AdminHero
        badge="📋 All posts"
        title="All announcement posts"
        subtitle="Tick to publish, unpublish or remove — one or many at once. Tap a row to read & edit it. 🗂️"
        back={{ href: "/admin/announcements", label: "Announcements" }}
      />
      <PostsManager
        posts={(items ?? []).map((a) => ({
          id: a.id as string,
          title: a.title as string,
          kind: a.kind as string,
          body: (a.body as string) ?? null,
          link_url: (a.link_url as string) ?? null,
          is_published: a.is_published as boolean,
          broadcast_at: (a.broadcast_at as string) ?? null,
          from_feed: (a.from_feed as boolean) ?? false,
        }))}
        actions={{ updateAnnouncement, deleteAnnouncement, broadcast: broadcastAnnouncement, bulkPublish, bulkUnpublish, bulkDelete }}
      />
    </section>
  );
}
