-- Fix RLS recursion caused by policies that call public.current_role().
-- The function must bypass profile RLS when reading the caller's role.
create or replace function public.current_role()
returns app_role
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
  limit 1
$$;

grant execute on function public.current_role() to authenticated;
