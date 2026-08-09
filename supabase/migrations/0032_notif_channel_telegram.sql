-- Telegram gets its own name.
--
-- The channel enum held only 'whatsapp' and 'email', so every daily target and
-- weekly study reminder — all of them sent over Telegram — was written down as
-- WhatsApp because there was nothing truer to write. 589 Telegram messages then
-- read as WhatsApp traffic, which is how a page of student conversations came to
-- look like 700 messages and why it seemed we were paying Meta to send them.
--
-- Adding the value must be its own migration: Postgres will not let a new enum
-- label be USED in the same transaction that creates it.

alter type notif_channel add value if not exists 'telegram';
