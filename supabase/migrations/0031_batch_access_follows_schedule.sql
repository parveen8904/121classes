-- WHEN THE BATCH GROWS, SO DOES EVERYONE'S ACCESS.
--
-- Reading the last class at the moment of purchase fixed the NEXT student. It
-- did nothing for the ones who had already paid: extend the schedule by three
-- classes and they are still locked out on the old date, having bought "the
-- batch" and been handed a calendar window.
--
-- So the schedule drives the access directly. Touch class_schedule and every
-- active subscription for that subject is brought up to the last class plus
-- its grace period.
--
-- IT ONLY EVER EXTENDS. If a class is cancelled and the batch ends sooner,
-- nobody's access is taken away: a student was told a date and may have
-- planned around it, and clawing that back to save ten days of nothing is not
-- worth being the kind of business that does it.
--
-- Applied to the live database as migration `batch_access_follows_schedule`.
-- Kept here so a fresh environment gets the same behaviour.

create or replace function sync_batch_access(p_subject uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  last_at timestamptz; grace integer; target timestamptz;
  changed integer := 0; subj text;
begin
  if p_subject is null then return 0; end if;

  select s.batch_grace_days, s.title into grace, subj from subjects s where s.id = p_subject;
  if grace is null then grace := 10; end if;

  -- An explicit date on the subject still wins; otherwise the schedule speaks.
  -- Cancelled sessions are ignored: a batch does not run longer because its
  -- final class was called off.
  select coalesce(
    (select s.batch_last_class_on::timestamptz from subjects s
      where s.id = p_subject and s.batch_last_class_on is not null),
    (select max(cs.scheduled_at) from class_schedule cs
      where cs.subject_id = p_subject and cs.status is distinct from 'cancelled')
  ) into last_at;
  if last_at is null then return 0; end if;

  -- End of the day, in the timezone the students actually live in. Access
  -- should not stop at midnight on the morning somebody planned to revise.
  target := ((last_at at time zone 'Asia/Kolkata')::date + grace + 1)::timestamp
            at time zone 'Asia/Kolkata' - interval '1 second';

  update subscriptions
     set ends_at = target
   where subject_id = p_subject and status = 'active'
     and (ends_at is null or ends_at < target);
  get diagnostics changed = row_count;

  -- Tell them, once per final date. A schedule edited five times should not
  -- send five messages; the dedupe key sees to that.
  if changed > 0 then
    perform queue_push('general', null, p_subject,
      'Your access has been extended',
      coalesce(subj, 'Your live batch') || ' now runs to ' ||
        to_char(target at time zone 'Asia/Kolkata', 'DD Mon YYYY') || '.',
      '/dashboard',
      'batch_ext:' || p_subject || ':' || to_char(target at time zone 'Asia/Kolkata', 'YYYY-MM-DD'));
  end if;

  return changed;
end $$;

create or replace function tg_schedule_changed() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform sync_batch_access(coalesce(new.subject_id, old.subject_id));
  return coalesce(new, old);
end $$;

drop trigger if exists schedule_extends_access on class_schedule;
create trigger schedule_extends_access
  after insert or update or delete on class_schedule
  for each row execute function tg_schedule_changed();
