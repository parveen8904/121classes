-- THE MISSING FOREIGN KEY THAT EMPTIED THE PETTY CASH PAGE.
--
-- His report, 2 September 2026: the list of people with advance given, advance
-- adjusted and closing balance had disappeared, and picking a person to pay an
-- advance said nobody existed -- while three people sat in the table.
--
-- On 1 September the balances query started asking for each person's login
-- email as an embedded row, `profiles(email)`. PostgREST resolves an embed
-- through a FOREIGN KEY, and petty_people never had one to profiles -- only its
-- own primary key. So the query failed, `data` came back null, the list became
-- an empty array, and every screen built from it silently showed nothing.
--
-- The relationship is real and every existing profile_id points at a profile
-- that exists, so this only writes down what was already true. ON DELETE SET
-- NULL: deleting a portal account must never take a petty cash ledger with it,
-- because the advances and bills against it are accounting records.
alter table public.petty_people
  add constraint petty_people_profile_id_fkey
  foreign key (profile_id) references public.profiles(id) on delete set null;

comment on constraint petty_people_profile_id_fkey on public.petty_people is
  'Also what lets PostgREST embed profiles(email) on the balances query. Added 2 Sep 2026 after its absence blanked the whole petty cash section.';
