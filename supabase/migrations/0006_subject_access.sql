-- =====================================================================
-- 121 Coaching — per-SUBJECT access (Phase: founder feedback r1)
-- Subscriptions can now target a single subject (subject_id) OR the whole
-- course (subject_id NULL = all subjects). Tiers stay hierarchical.
-- =====================================================================

-- Subject-level subscriptions (NULL = whole course, back-compatible).
alter table subscriptions
  add column if not exists subject_id uuid references subjects(id) on delete cascade;

-- True if the user has an active sub (at/above tier) for THIS subject
-- specifically, OR a whole-course sub for the subject's course.
create or replace function public.has_subject_access(subject uuid, needed plan_tier)
returns boolean language sql stable security definer set search_path = public as $$
  select needed is null or exists (
    select 1
    from subscriptions s
    join plans p on p.id = s.plan_id
    join subjects subj on subj.id = subject
    where s.student_id = auth.uid()
      and s.status = 'active'
      and now() between s.starts_at and s.ends_at
      and plan_rank(p.tier) >= plan_rank(needed)
      and (s.subject_id = subject or (s.subject_id is null and s.course_id = subj.course_id))
  );
$$;

-- Gate sections by subject access (was course access).
drop policy if exists sections_read on sections;
create policy sections_read on sections for select using (
  is_admin() or (
    is_published and (
      min_plan is null or
      has_subject_access((select t.subject_id from topics t where t.id = topic_id), min_plan)
    )
  )
);

-- The student-facing listing uses subject access too.
create or replace function public.list_topic_sections(p_topic uuid)
returns table (id uuid, type section_type, title text, order_index int, min_plan plan_tier, unlocked boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.type, s.title, s.order_index, s.min_plan,
    (s.min_plan is null or public.has_subject_access(
       (select t.subject_id from topics t where t.id = s.topic_id), s.min_plan)) as unlocked
  from sections s
  where s.topic_id = p_topic and s.is_published
  order by s.order_index, s.title;
$$;
