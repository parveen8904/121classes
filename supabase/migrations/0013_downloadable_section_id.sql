-- Add section_id to the downloadable-classes catalog so the class page can show
-- a "Download for offline" button on the exact section that has an encrypted copy.
drop function if exists list_downloadable_classes();
create function list_downloadable_classes()
returns table (
  id uuid, title text, subject_id uuid, subject_title text, section_id uuid,
  storage_url text, iv_b64 text, alg text, byte_size bigint
)
language sql stable security definer set search_path = public as $$
  select pv.id, pv.title, pv.subject_id, s.title, pv.section_id, pv.storage_url, pv.iv_b64, pv.alg, pv.byte_size
  from protected_videos pv
  left join subjects s on s.id = pv.subject_id
  where pv.is_published
    and (pv.subject_id is null or has_subject_access(pv.subject_id, pv.min_plan));
$$;
revoke all on function list_downloadable_classes() from public;
grant execute on function list_downloadable_classes() to authenticated;
