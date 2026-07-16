-- Twitter/X as a prepare-and-remind campaign channel (free-paste — X's posting
-- API is paid, so we email the ready-to-paste tweet at send time like IG/YT).
alter table public.scheduled_posts add column if not exists to_twitter boolean not null default false;
