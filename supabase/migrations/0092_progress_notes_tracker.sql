create table if not exists public.progress_notes (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  note_date date not null,
  note_body text not null default '',
  status text not null default 'draft' check (status in ('draft', 'signed')),
  signed_at timestamptz,
  signed_by_user_id uuid references public.profiles(id) on delete set null,
  signed_by_name text,
  created_by_user_id uuid references public.profiles(id) on delete set null,
  created_by_name text,
  updated_by_user_id uuid references public.profiles(id) on delete set null,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint progress_notes_signed_consistency check (
    (status = 'draft' and signed_at is null and signed_by_user_id is null and signed_by_name is null)
    or (status = 'signed' and signed_at is not null)
  )
);

create index if not exists idx_progress_notes_member_status_updated
  on public.progress_notes(member_id, status, updated_at desc);

create index if not exists idx_progress_notes_member_signed_at
  on public.progress_notes(member_id, signed_at desc)
  where status = 'signed';

create unique index if not exists idx_progress_notes_member_single_draft
  on public.progress_notes(member_id)
  where status = 'draft';

drop trigger if exists trg_progress_notes_updated on public.progress_notes;
create trigger trg_progress_notes_updated before update on public.progress_notes
for each row execute function public.set_updated_at();

alter table public.progress_notes enable row level security;

drop policy if exists "progress_notes_select" on public.progress_notes;
drop policy if exists "progress_notes_insert" on public.progress_notes;
drop policy if exists "progress_notes_update" on public.progress_notes;

create policy "progress_notes_select"
on public.progress_notes
for select
to authenticated
using (public.current_role() in ('admin', 'nurse'));

create policy "progress_notes_insert"
on public.progress_notes
for insert
to authenticated
with check (
  public.current_role() in ('admin', 'nurse')
  and (created_by_user_id is null or created_by_user_id = public.current_profile_id())
  and (updated_by_user_id is null or updated_by_user_id = public.current_profile_id())
  and (signed_by_user_id is null or signed_by_user_id = public.current_profile_id())
);

create policy "progress_notes_update"
on public.progress_notes
for update
to authenticated
using (public.current_role() in ('admin', 'nurse'))
with check (
  public.current_role() in ('admin', 'nurse')
  and (updated_by_user_id is null or updated_by_user_id = public.current_profile_id())
  and (signed_by_user_id is null or signed_by_user_id = public.current_profile_id())
);
