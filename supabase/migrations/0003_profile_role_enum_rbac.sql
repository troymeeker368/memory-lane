do $$
begin
  alter type app_role add value if not exists 'program-assistant';
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter type app_role add value if not exists 'coordinator';
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter type app_role add value if not exists 'sales';
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter type app_role add value if not exists 'director';
exception
  when duplicate_object then null;
end $$;

update public.profiles
set role = 'program-assistant'
where role = 'staff';

