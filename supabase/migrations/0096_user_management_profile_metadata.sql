alter table public.profiles
  add column if not exists credentials text,
  add column if not exists phone text,
  add column if not exists title text,
  add column if not exists department text,
  add column if not exists default_landing text;

update public.profiles
set default_landing = '/'
where coalesce(nullif(btrim(default_landing), ''), '') = '';

alter table public.profiles
  alter column default_landing set default '/',
  alter column default_landing set not null;
