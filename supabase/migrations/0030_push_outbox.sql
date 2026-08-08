-- NOTIFICATIONS THAT SEND THEMSELVES.
--
-- A student registered for Financial Reporting should hear when a class is
-- added to it, when a live session is planned, when a test appears, and when
-- their own copy comes back checked — without anybody remembering to tell them.
--
-- Two decisions shape everything here.
--
-- FIRST: the events are captured by DATABASE TRIGGERS, not by editing a dozen
-- admin actions. Content arrives by several routes — the section editor, the
-- repository ingest, bulk imports, and whatever gets written next year — and a
-- notification that only fires from one of them is worse than none, because it
-- teaches students that silence means nothing happened. A trigger on the table
-- cannot be bypassed by a new code path.
--
-- SECOND: nothing is sent from the trigger. It only writes a row here. Sending
-- inline would make a save wait on Apple and Google, and would fire ten
-- notifications when ten classes are uploaded in a minute. A cron drains this,
-- and coalesces: ten classes in one subject become one line that says ten.

create table if not exists push_outbox (
  id           uuid primary key default gen_random_uuid(),
  -- What happened. Used to group and to word the message, and to let the
  -- founder switch a whole category off.
  kind         text not null check (kind in ('content','live_new','live_soon','test','copy_checked','general')),
  -- Who should hear. Exactly one of these decides the audience:
  --   student_id set  -> that student alone (their copy came back)
  --   subject_id set  -> everyone with live access to that subject
  --   both null       -> every student with the app
  student_id   uuid references auth.users(id) on delete cascade,
  subject_id   uuid references subjects(id) on delete cascade,
  title        text not null,
  body         text not null default '',
  link         text,
  -- Stops the same event queueing twice — a re-save, a retried import, a
  -- trigger that fires on an unrelated column. Without it, editing a class
  -- title would re-announce the class.
  dedupe_key   text unique,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  sent_count   integer
);

create index if not exists push_outbox_pending_idx on push_outbox (created_at) where sent_at is null;

alter table push_outbox enable row level security;
-- No policy: only the service role touches this. Students never read the queue.

-- ---------------------------------------------------------------------------
-- Queue helper. Silently ignores a duplicate, which is the whole point of the
-- dedupe key — the caller should not have to care whether it already fired.
create or replace function queue_push(
  p_kind text, p_student uuid, p_subject uuid,
  p_title text, p_body text, p_link text, p_dedupe text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into push_outbox (kind, student_id, subject_id, title, body, link, dedupe_key)
  values (p_kind, p_student, p_subject, p_title, p_body, p_link, p_dedupe)
  on conflict (dedupe_key) do nothing;
end $$;

-- ---------------------------------------------------------------------------
-- A class, note or test appearing in a subject.
--
-- Fires when a section becomes published — either created that way or flipped
-- later. Not on every update: a corrected title is not news.
create or replace function tg_section_published() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  subj uuid;
  subj_name text;
begin
  if new.is_published is not true then return new; end if;
  if tg_op = 'UPDATE' and coalesce(old.is_published, false) = true then return new; end if;

  select t.subject_id, s.title into subj, subj_name
  from topics t join subjects s on s.id = t.subject_id
  where t.id = new.topic_id;
  if subj is null then return new; end if;

  perform queue_push(
    'content', null, subj,
    'New in ' || coalesce(subj_name, 'your course'),
    coalesce(new.title, 'New material has been added.'),
    '/learn/section/' || new.id,
    'section:' || new.id
  );
  return new;
end $$;

drop trigger if exists section_published_push on sections;
create trigger section_published_push
  after insert or update of is_published on sections
  for each row execute function tg_section_published();

-- ---------------------------------------------------------------------------
-- A live class being planned.
--
-- live_sessions has no subject column — its audience is a free-text field — so
-- this goes to everyone. Narrowing it needs a subject on the session, which is
-- a change to that screen rather than to this trigger.
create or replace function tg_live_published() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_published is not true then return new; end if;
  if tg_op = 'UPDATE' and coalesce(old.is_published, false) = true then return new; end if;

  perform queue_push(
    'live_new', null, null,
    'Live class planned',
    coalesce(new.title, 'A live class has been scheduled.') ||
      case when new.starts_at is null then ''
           else ' — ' || to_char(new.starts_at at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM') end,
    '/live',
    'live_new:' || new.id
  );
  return new;
end $$;

drop trigger if exists live_published_push on live_sessions;
create trigger live_published_push
  after insert or update of is_published on live_sessions
  for each row execute function tg_live_published();

-- ---------------------------------------------------------------------------
-- A student's own copy coming back checked.
--
-- This one is personal, so it goes to that student and nobody else. It fires
-- when the examiner releases it — not when the AI finishes, because a mark the
-- student cannot see yet is not news they can act on.
create or replace function tg_copy_released() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.review_status, '') <> 'released' then return new; end if;
  if coalesce(old.review_status, '') = 'released' then return new; end if;

  perform queue_push(
    'copy_checked', new.student_id, null,
    'Your copy has been checked',
    case when new.awarded_marks is not null and new.total_marks is not null
         then 'You scored ' || trim(to_char(new.awarded_marks, 'FM999999.99')) ||
              ' out of ' || trim(to_char(new.total_marks, 'FM999999.99')) || '. Tap to see the report.'
         else 'Your answer copy has been checked. Tap to see the report.' end,
    '/learn/tests',
    'copy:' || new.id
  );
  return new;
end $$;

drop trigger if exists copy_released_push on descriptive_attempts;
create trigger copy_released_push
  after update of review_status on descriptive_attempts
  for each row execute function tg_copy_released();
