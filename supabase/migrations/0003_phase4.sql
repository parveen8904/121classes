-- =====================================================================
-- 121 Coaching — Phase 4 (subscriptions & enrolment)
-- Student self-service: let a student flip auto-renew on THEIR OWN
-- subscription without granting a broad UPDATE policy (which would let
-- them tamper with ends_at / plan_id). SECURITY DEFINER + an ownership
-- check keeps it tight. Admin grants/cancel/extend go through the
-- existing `subsr_admin` RLS policy.
-- Run in Supabase: SQL Editor → paste → Run. Safe to re-run.
-- =====================================================================

begin;

create or replace function public.set_my_auto_renew(p_sub uuid, p_on boolean)
returns void
language sql security definer set search_path = public as $$
  update subscriptions
     set auto_renew = p_on
   where id = p_sub
     and student_id = auth.uid();
$$;

grant execute on function public.set_my_auto_renew(uuid, boolean) to authenticated;

commit;
