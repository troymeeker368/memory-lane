-- Ensure RLS role checks work with auth-backed profile identities.
-- New auth lifecycle stores auth user identity in profiles.auth_user_id.
-- Keep legacy fallback to profiles.id for backward compatibility.
create or replace function public.current_role()
returns app_role
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.auth_user_id = auth.uid()
     or p.id = auth.uid()
  order by
    case when p.auth_user_id = auth.uid() then 0 else 1 end,
    p.updated_at desc nulls last
  limit 1
$$;

grant execute on function public.current_role() to authenticated;
