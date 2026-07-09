-- CRITICAL: protect_privileged_profile_cols was SECURITY DEFINER, so current_user
-- inside it was always the owner (postgres) → its privileged-role check passed for
-- everyone, letting any student self-promote to admin. SECURITY INVOKER makes
-- current_user the real caller (authenticated for students → blocked).
create or replace function public.protect_privileged_profile_cols()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $function$
begin
  if (new.role is distinct from old.role)
     or (new.permissions is distinct from old.permissions) then
    if current_user in ('postgres', 'supabase_admin', 'service_role', 'supabase_auth_admin')
       or public.is_admin() then
      return new;
    end if;
    raise exception 'changing role/permissions requires an administrator';
  end if;
  return new;
end $function$;
