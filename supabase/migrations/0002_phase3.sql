-- =====================================================================
-- 121 Coaching — Phase 3 (student portal): section-gating helper + AS 24 seed
-- Run in Supabase: SQL Editor → paste → Run. Safe to re-run (idempotent).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- list_topic_sections(topic): returns published section METADATA for a
-- topic (no `config`), with an `unlocked` flag computed from the caller's
-- subscriptions. SECURITY DEFINER bypasses the strict sections RLS so the
-- student can see *that* a locked section exists (to prompt an upgrade),
-- while the protected `config` (video ids, pdf urls) stays behind RLS and
-- is only fetched for unlocked sections via the normal table policy.
-- ---------------------------------------------------------------------
create or replace function public.list_topic_sections(p_topic uuid)
returns table (
  id          uuid,
  type        section_type,
  title       text,
  order_index int,
  min_plan    plan_tier,
  unlocked    boolean
)
language sql stable security definer set search_path = public as $$
  select
    s.id,
    s.type,
    s.title,
    s.order_index,
    s.min_plan,
    (
      s.min_plan is null
      or public.has_course_access(
           (select subj.course_id
              from subjects subj
              join topics t on t.subject_id = subj.id
             where t.id = s.topic_id),
           s.min_plan)
    ) as unlocked
  from sections s
  where s.topic_id = p_topic
    and s.is_published
  order by s.order_index, s.title;
$$;

grant execute on function public.list_topic_sections(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Seed the AS 24 sample (migrated from the legacy courses.html page).
-- Guarded: only seeds if the topic doesn't already exist.
-- ---------------------------------------------------------------------
do $$
declare
  v_course  uuid;
  v_subject uuid;
  v_faculty uuid;
  v_topic   uuid;
begin
  if exists (select 1 from topics where slug = 'as-24-discontinuing-operations') then
    return;
  end if;

  insert into courses (title, slug, order_index, is_published)
  values ('CA Intermediate', 'ca-intermediate', 0, true)
  on conflict (slug) do update set is_published = true
  returning id into v_course;

  insert into subjects (course_id, title, slug, order_index)
  values (v_course, 'Accounting', 'accounting', 0)
  returning id into v_subject;

  select id into v_faculty from faculties where full_name = 'CA Parveen Sharma' limit 1;
  if v_faculty is null then
    insert into faculties (full_name, bio)
    values ('CA Parveen Sharma', 'Founder & lead faculty, 1:1 CA Classes.')
    returning id into v_faculty;
  end if;
  insert into subject_faculty (subject_id, faculty_id)
  values (v_subject, v_faculty)
  on conflict do nothing;

  insert into topics (subject_id, title, slug, order_index, is_published, amendments_upto)
  values (v_subject, 'AS 24 – Discontinuing Operations', 'as-24-discontinuing-operations', 0, true, null)
  returning id into v_topic;

  insert into sections (topic_id, type, title, order_index, min_plan, config, is_published) values
    (v_topic, 'revision_video', 'Main Revision', 1, null,
       '{"embed_url":"https://app.heygen.com/embeds/c2bcd7138f2c42b6b607fe6588910b89"}', true),
    (v_topic, 'revision_video', 'First Revision (with questions)', 2, 'bronze',
       '{"revision_round":"First"}', true),
    (v_topic, 'revision_video', 'Second Revision (clean)', 3, 'bronze',
       '{"revision_round":"Second"}', true),
    (v_topic, 'pdf', 'Slides (PDF)', 4, 'bronze', '{}', true),
    (v_topic, 'pdf', 'Question Bank (PDF)', 5, 'bronze', '{}', true),
    (v_topic, 'past_papers', 'Past Examination Questions', 6, 'bronze', '{}', true),
    (v_topic, 'mcq_test', 'MCQ Test', 7, 'bronze', '{}', true),
    (v_topic, 'subjective_test', 'Subjective Test', 8, 'silver', '{}', true),
    (v_topic, 'ask_doubt', 'Ask a Doubt (AI)', 9, 'silver', '{}', true);
end $$;

commit;
