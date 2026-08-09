-- Put the Telegram messages back where they belong.
--
-- Daily targets go out with sendTelegramMessage, full stop. Weekly study
-- reminders go to Telegram when the student has linked it, and to email
-- otherwise — and the email ones were already labelled email, so only the
-- Telegram half is wrong here.
--
-- Nothing is deleted: the rows are the record that the message went. Only the
-- channel name changes, so the WhatsApp inbox shows conversations with students
-- and nothing else.

update notifications
   set channel = 'telegram'
 where channel = 'whatsapp'
   and template in ('daily_target', 'study_reminder');
