-- ONE DO-NOT-CONTACT LIST, FOR EVERY CHANNEL.
--
-- "Do it for telegram and WhatsApp also" — the founder, 4 September 2026.
--
-- A SECOND list would have been the easy build and the wrong one. The comment
-- already on this table says why: every previous fix was aimed at a particular
-- sender, each was real, each was fixed, and mail kept arriving because there
-- was always one more sender nobody had thought of. Two lists is the same
-- mistake with a new shape.
--
-- So the list is widened rather than duplicated. `email` now holds whatever
-- identifies the person on that channel — an address, a phone number, or a
-- Telegram chat id — and `channel` says which.
alter table email_blocklist
  add column if not exists channel text not null default 'email';

comment on column email_blocklist.email is
  'The handle to refuse: an email address, a WhatsApp number (digits, country code first), or a Telegram chat id. Read with `channel`.';
comment on column email_blocklist.channel is
  'Which channel this handle belongs to: email | whatsapp | telegram.';

alter table email_blocklist drop constraint if exists email_blocklist_pkey;
alter table email_blocklist add primary key (channel, email);

create index if not exists email_blocklist_channel_idx on email_blocklist (channel);
