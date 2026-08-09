-- Which social comments we have already looked at.
--
-- Meta gives no "since" cursor worth trusting for comments, so every run reads
-- the same recent posts. Without a memory of what has been considered, a
-- comment we deliberately left alone — praise, an emoji, an insult — would be
-- reconsidered every hour for ever, and one we logged would be logged twice.
--
-- The key is "<platform>:<comment id>", so the two networks cannot collide.

create table if not exists social_comments_seen (
  comment_key text primary key,
  seen_at timestamptz not null default now()
);

alter table social_comments_seen enable row level security;
-- No policy: written only by the cron, through the service role.
