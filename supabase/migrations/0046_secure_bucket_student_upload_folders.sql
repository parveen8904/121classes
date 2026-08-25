-- SCHOLARSHIP AND AWARDS UPLOADS WERE REFUSED FOR EVERY STUDENT.
--
-- Reported through Ravi, 25 Aug 2026: "student facing this issue" on the
-- scholarship marksheet upload. The secure bucket's INSERT policy listed the
-- folders a student may write to -- descriptive, paper, paper-check -- and the
-- scholarship form writes to `scholarship/` while the awards form writes to
-- `awards/`. Neither was on the list, so row-level security refused every one
-- of those uploads, and the form showed only "Upload failed - please try
-- again", which sent students round the same loop for ever.
--
-- The two folders are added to the list rather than the bucket being opened:
-- the secure bucket also holds paid PDFs and marked answer copies, and a
-- student writing anywhere in it is not what was wanted.
drop policy if exists secure_answer_upload on storage.objects;
create policy secure_answer_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'secure'
    and (
      (storage.foldername(name))[1] = any (array['descriptive','paper','paper-check','scholarship','awards'])
      or is_admin()
    )
  );

drop policy if exists secure_answer_update on storage.objects;
create policy secure_answer_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'secure'
    and (
      (storage.foldername(name))[1] = any (array['descriptive','paper','paper-check','scholarship','awards'])
      or is_admin()
    )
  );
