-- =====================================================================
-- 121 Coaching — Bronze becomes a FREE tier
-- Bronze content needs no subscription; ₹0 price. Silver/Gold still paid.
-- Applied via Supabase MCP.
-- =====================================================================

update plans set web_price_inr = 0, app_price_inr = 0 where tier = 'bronze';

create or replace function public.has_subject_access(subject uuid, needed plan_tier)
returns boolean language sql stable security definer set search_path = public as $$
  select needed is null
    or plan_rank(needed) <= 1
    or exists (
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

create or replace function public.has_course_access(course uuid, needed plan_tier)
returns boolean language sql stable security definer set search_path = public as $$
  select needed is null
    or plan_rank(needed) <= 1
    or exists (
      select 1
      from subscriptions s
      join plans p on p.id = s.plan_id
      where s.student_id = auth.uid()
        and s.course_id  = course
        and s.status     = 'active'
        and now() between s.starts_at and s.ends_at
        and plan_rank(p.tier) >= plan_rank(needed)
    );
$$;
