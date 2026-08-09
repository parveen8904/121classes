-- WHAT STUDENTS THINK OF THE PLACE.
--
-- Ten questions, answered in a minute. The point is not a score to put on a
-- slide: it is to hear that the descriptive checking was unfair, or that an
-- answer was wrong, from the people it happened to — while they still remember.
--
-- Nothing is required except a name and one answer, because a form that demands
-- a phone number before it will listen is a form nobody fills in. Signing in is
-- not required either: the people worth hearing from most are often the ones who
-- looked at the site and left.

create table if not exists student_feedback (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references profiles(id) on delete set null,

  name text not null,
  email text,
  phone text,

  -- 1 (poor) to 5 (excellent). Null means they skipped it — which is itself
  -- worth knowing, so a skipped question is never counted as a middling score.
  overall           smallint check (overall between 1 and 5),
  answer_accuracy   smallint check (answer_accuracy between 1 and 5),
  answer_speed      smallint check (answer_speed between 1 and 5),
  paper_checking    smallint check (paper_checking between 1 and 5),
  classes_quality   smallint check (classes_quality between 1 and 5),
  material_quality  smallint check (material_quality between 1 and 5),
  app_experience    smallint check (app_experience between 1 and 5),
  planner_useful    smallint check (planner_useful between 1 and 5),
  would_recommend   smallint check (would_recommend between 1 and 5),

  -- The two that actually change anything.
  what_went_wrong text,
  how_to_improve  text,

  source text default 'footer',
  created_at timestamptz not null default now()
);

create index if not exists student_feedback_created_idx on student_feedback (created_at desc);

alter table student_feedback enable row level security;

drop policy if exists "anyone can leave feedback" on student_feedback;
create policy "anyone can leave feedback" on student_feedback
  for insert to anon, authenticated with check (true);

-- Reading is staff-only, through the service role. No select policy on purpose:
-- one student must never be able to read another's complaint.
