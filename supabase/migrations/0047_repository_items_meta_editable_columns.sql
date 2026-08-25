-- The admin repository page can now EDIT an item, not only add or delete one.
-- The edit form has to show what the item currently holds, and three of those
-- fields were not on the metadata view: which course it belongs to, whether it
-- is shared on the public Resources page, and the label it carries there.
--
-- The view exists to keep `content` out of list queries -- selecting it pulled
-- 18 MB per page view. These three are small scalars and change nothing about
-- that: `content` stays out, and only its derived flags are exposed as before.
--
-- Appended at the END rather than placed alongside subject_id: `create or
-- replace view` may only add columns after the existing ones, and dropping the
-- view to reorder them would take its grants with it for no gain.
create or replace view public.repository_items_meta as
  SELECT id,
    title,
    kind,
    subject_id,
    file_url,
    valid_from,
    valid_to,
    valid_from_attempt,
    is_active,
    created_at,
    COALESCE(length(content), 0) AS content_chars,
    content = '__unreadable__'::text AS is_unreadable,
    content IS NOT NULL AND content <> '__unreadable__'::text AND length(content) > 100 AS has_text,
    course_id,
    share_to_resources,
    resource_label
   FROM repository_items;
