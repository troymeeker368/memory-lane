create table if not exists public.intake_assessment_signatures (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null unique references public.intake_assessments(id) on delete cascade,
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

create index if not exists idx_intake_assessment_signatures_member_signed_at
  on public.intake_assessment_signatures(member_id, signed_at desc);

alter table public.intake_assessments
  add column if not exists signed_by_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists signed_at timestamptz,
  add column if not exists signature_status text not null default 'unsigned',
  add column if not exists signature_metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'intake_assessments_signature_status_check'
  ) then
    alter table public.intake_assessments
      add constraint intake_assessments_signature_status_check
      check (signature_status in ('unsigned', 'signed', 'voided'));
  end if;
end
$$;

insert into public.intake_assessment_signatures (
  assessment_id,
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
  intake.id,
  intake.member_id,
  intake.completed_by_user_id,
  coalesce(nullif(trim(intake.signed_by), ''), coalesce(nullif(trim(intake.completed_by), ''), 'Unknown Signer')),
  coalesce(intake.signed_at, intake.updated_at, intake.created_at, now()),
  'signed',
  jsonb_build_object('migratedFromLegacyTypedSignature', true),
  coalesce(intake.created_at, now()),
  coalesce(intake.updated_at, now())
from public.intake_assessments intake
where coalesce(trim(intake.signed_by), '') <> ''
  and intake.completed_by_user_id is not null
on conflict (assessment_id) do nothing;

update public.intake_assessments intake
set
  signed_by = sig.signed_by_name,
  signed_by_user_id = sig.signed_by_user_id,
  signed_at = sig.signed_at,
  signature_status = sig.status,
  signature_metadata = sig.signature_metadata
from public.intake_assessment_signatures sig
where sig.assessment_id = intake.id;

update public.intake_assessments
set
  signature_status = 'unsigned',
  signature_metadata = case
    when signature_metadata = '{}'::jsonb and coalesce(trim(signed_by), '') <> '' and signed_by_user_id is null
      then jsonb_build_object('legacySignatureNeedsResign', true)
    else signature_metadata
  end
where signature_status not in ('signed', 'voided');

drop trigger if exists trg_intake_assessment_signatures_updated on public.intake_assessment_signatures;
create trigger trg_intake_assessment_signatures_updated
before update on public.intake_assessment_signatures
for each row execute function public.set_updated_at();

alter table public.intake_assessment_signatures enable row level security;

drop policy if exists "intake_assessment_signatures_select" on public.intake_assessment_signatures;
drop policy if exists "intake_assessment_signatures_insert" on public.intake_assessment_signatures;
drop policy if exists "intake_assessment_signatures_update" on public.intake_assessment_signatures;
create policy "intake_assessment_signatures_select" on public.intake_assessment_signatures for select to authenticated using (true);
create policy "intake_assessment_signatures_insert" on public.intake_assessment_signatures for insert to authenticated with check (true);
create policy "intake_assessment_signatures_update" on public.intake_assessment_signatures for update to authenticated using (true) with check (true);
