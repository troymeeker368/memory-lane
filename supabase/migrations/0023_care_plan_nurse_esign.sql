alter table public.care_plans
  add column if not exists nurse_signature_status text not null default 'unsigned',
  add column if not exists nurse_signed_by_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists nurse_signed_by_name text,
  add column if not exists nurse_signature_artifact_storage_path text,
  add column if not exists nurse_signature_artifact_member_file_id text references public.member_files(id) on delete set null,
  add column if not exists nurse_signature_metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'care_plans_nurse_signature_status_check'
  ) then
    alter table public.care_plans
      add constraint care_plans_nurse_signature_status_check
      check (nurse_signature_status in ('unsigned', 'signed', 'voided'));
  end if;
end
$$;

create index if not exists idx_care_plans_nurse_signature_status
  on public.care_plans(nurse_signature_status, nurse_signed_at desc);

create index if not exists idx_care_plans_nurse_signed_by_user
  on public.care_plans(nurse_signed_by_user_id);

create table if not exists public.care_plan_nurse_signatures (
  care_plan_id uuid primary key references public.care_plans(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  signed_by_user_id uuid not null references public.profiles(id) on delete restrict,
  signed_by_name text not null,
  signed_at timestamptz not null,
  status text not null default 'signed' check (status in ('signed', 'voided')),
  signature_artifact_storage_path text,
  signature_artifact_member_file_id text references public.member_files(id) on delete set null,
  signature_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_care_plan_nurse_signatures_member_signed_at
  on public.care_plan_nurse_signatures(member_id, signed_at desc);

create index if not exists idx_care_plan_nurse_signatures_signed_by_user
  on public.care_plan_nurse_signatures(signed_by_user_id, signed_at desc);

drop trigger if exists trg_care_plan_nurse_signatures_updated on public.care_plan_nurse_signatures;
create trigger trg_care_plan_nurse_signatures_updated
before update on public.care_plan_nurse_signatures
for each row execute function public.set_updated_at();

alter table public.care_plan_nurse_signatures enable row level security;

drop policy if exists "care_plan_nurse_signatures_select" on public.care_plan_nurse_signatures;
drop policy if exists "care_plan_nurse_signatures_insert" on public.care_plan_nurse_signatures;
drop policy if exists "care_plan_nurse_signatures_update" on public.care_plan_nurse_signatures;
create policy "care_plan_nurse_signatures_select"
  on public.care_plan_nurse_signatures
  for select to authenticated
  using (true);
create policy "care_plan_nurse_signatures_insert"
  on public.care_plan_nurse_signatures
  for insert to authenticated
  with check (true);
create policy "care_plan_nurse_signatures_update"
  on public.care_plan_nurse_signatures
  for update to authenticated
  using (true)
  with check (true);

with resolved as (
  select
    cp.id as care_plan_id,
    cp.member_id,
    cp.nurse_designee_user_id as signed_by_user_id,
    coalesce(
      nullif(btrim(cp.nurse_designee_name), ''),
      nullif(btrim(cp.administrator_signature), ''),
      nullif(btrim(cp.completed_by), '')
    ) as signed_by_name,
    coalesce(
      cp.nurse_signed_at,
      case
        when cp.administrator_signature_date is not null then (cp.administrator_signature_date::text || 'T12:00:00.000Z')::timestamptz
        when cp.date_of_completion is not null then (cp.date_of_completion::text || 'T12:00:00.000Z')::timestamptz
        else null
      end
    ) as signed_at
  from public.care_plans cp
)
insert into public.care_plan_nurse_signatures (
  care_plan_id,
  member_id,
  signed_by_user_id,
  signed_by_name,
  signed_at,
  status,
  signature_metadata,
  created_at,
  updated_at
)
select
  r.care_plan_id,
  r.member_id,
  r.signed_by_user_id,
  r.signed_by_name,
  r.signed_at,
  'signed',
  jsonb_build_object('migratedFrom', 'care_plans'),
  now(),
  now()
from resolved r
where r.signed_by_user_id is not null
  and r.signed_by_name is not null
  and r.signed_at is not null
on conflict (care_plan_id) do nothing;

update public.care_plans cp
set
  nurse_signature_status = sig.status,
  nurse_signed_by_user_id = sig.signed_by_user_id,
  nurse_signed_by_name = sig.signed_by_name,
  nurse_signed_at = sig.signed_at,
  nurse_signature_artifact_storage_path = sig.signature_artifact_storage_path,
  nurse_signature_artifact_member_file_id = sig.signature_artifact_member_file_id,
  nurse_signature_metadata = sig.signature_metadata,
  completed_by = sig.signed_by_name,
  date_of_completion = coalesce(cp.date_of_completion, (sig.signed_at at time zone 'America/New_York')::date),
  administrator_signature = sig.signed_by_name,
  administrator_signature_date = coalesce(cp.administrator_signature_date, (sig.signed_at at time zone 'America/New_York')::date),
  nurse_designee_user_id = sig.signed_by_user_id,
  nurse_designee_name = sig.signed_by_name
from public.care_plan_nurse_signatures sig
where cp.id = sig.care_plan_id;

update public.care_plans cp
set
  nurse_signature_status = 'unsigned',
  nurse_signed_by_user_id = null,
  nurse_signed_by_name = null,
  nurse_signature_artifact_storage_path = null,
  nurse_signature_artifact_member_file_id = null,
  nurse_signature_metadata = case
    when nurse_signature_metadata = '{}'::jsonb
      and (
        nullif(btrim(coalesce(cp.administrator_signature, '')), '') is not null
        or nullif(btrim(coalesce(cp.nurse_designee_name, '')), '') is not null
        or nullif(btrim(coalesce(cp.completed_by, '')), '') is not null
      )
    then jsonb_build_object('legacySignatureNeedsResign', true, 'migratedFrom', 'care_plans')
    else nurse_signature_metadata
  end
where not exists (
  select 1
  from public.care_plan_nurse_signatures sig
  where sig.care_plan_id = cp.id
);
