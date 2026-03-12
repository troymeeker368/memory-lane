create table if not exists public.pof_requests (
  id uuid primary key default gen_random_uuid(),
  physician_order_id uuid not null references public.physician_orders(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  provider_name text not null,
  provider_email text not null,
  nurse_name text not null,
  from_email text not null,
  sent_by_user_id uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'sent', 'opened', 'signed', 'declined', 'expired')),
  optional_message text,
  sent_at timestamptz,
  opened_at timestamptz,
  signed_at timestamptz,
  expires_at timestamptz not null,
  signature_request_token text not null,
  signature_request_url text not null,
  unsigned_pdf_url text,
  signed_pdf_url text,
  member_file_id text references public.member_files(id) on delete set null,
  created_by_user_id uuid references public.profiles(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_by_user_id uuid references public.profiles(id) on delete set null,
  updated_by_name text,
  updated_at timestamptz not null default now()
);

create index if not exists idx_pof_requests_member_updated on public.pof_requests(member_id, updated_at desc);
create index if not exists idx_pof_requests_physician_order on public.pof_requests(physician_order_id, created_at desc);
create index if not exists idx_pof_requests_status_expires on public.pof_requests(status, expires_at);
create unique index if not exists idx_pof_requests_signature_token on public.pof_requests(signature_request_token);

create table if not exists public.pof_signatures (
  id uuid primary key default gen_random_uuid(),
  pof_request_id uuid not null unique references public.pof_requests(id) on delete cascade,
  provider_typed_name text not null,
  provider_signature_image_url text not null,
  provider_ip text,
  provider_user_agent text,
  signed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pof_signatures_signed_at on public.pof_signatures(signed_at desc);

create table if not exists public.document_events (
  id uuid primary key default gen_random_uuid(),
  document_type text not null check (document_type in ('pof_request')),
  document_id uuid not null references public.pof_requests(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  physician_order_id uuid references public.physician_orders(id) on delete set null,
  event_type text not null check (event_type in ('created', 'sent', 'opened', 'signed', 'declined', 'expired', 'resent')),
  actor_type text not null check (actor_type in ('user', 'provider', 'system')),
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_name text,
  actor_email text,
  actor_ip text,
  actor_user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_document_events_document_created on public.document_events(document_id, created_at asc);
create index if not exists idx_document_events_member_created on public.document_events(member_id, created_at desc);

alter table public.member_files
  add column if not exists pof_request_id uuid references public.pof_requests(id) on delete set null,
  add column if not exists storage_object_path text;

create index if not exists idx_member_files_pof_request on public.member_files(pof_request_id);

drop trigger if exists trg_pof_requests_updated on public.pof_requests;
create trigger trg_pof_requests_updated before update on public.pof_requests
for each row execute function public.set_updated_at();

drop trigger if exists trg_pof_signatures_updated on public.pof_signatures;
create trigger trg_pof_signatures_updated before update on public.pof_signatures
for each row execute function public.set_updated_at();

alter table public.pof_requests enable row level security;
alter table public.pof_signatures enable row level security;
alter table public.document_events enable row level security;

drop policy if exists "pof_requests_select" on public.pof_requests;
drop policy if exists "pof_requests_insert" on public.pof_requests;
drop policy if exists "pof_requests_update" on public.pof_requests;
create policy "pof_requests_select" on public.pof_requests for select to authenticated using (true);
create policy "pof_requests_insert" on public.pof_requests for insert to authenticated with check (true);
create policy "pof_requests_update" on public.pof_requests for update to authenticated using (true) with check (true);

drop policy if exists "pof_signatures_select" on public.pof_signatures;
drop policy if exists "pof_signatures_insert" on public.pof_signatures;
drop policy if exists "pof_signatures_update" on public.pof_signatures;
create policy "pof_signatures_select" on public.pof_signatures for select to authenticated using (true);
create policy "pof_signatures_insert" on public.pof_signatures for insert to authenticated with check (true);
create policy "pof_signatures_update" on public.pof_signatures for update to authenticated using (true) with check (true);

drop policy if exists "document_events_select" on public.document_events;
drop policy if exists "document_events_insert" on public.document_events;
create policy "document_events_select" on public.document_events for select to authenticated using (true);
create policy "document_events_insert" on public.document_events for insert to authenticated with check (true);

do $$
begin
  begin
    insert into storage.buckets (id, name, public)
    values ('member-documents', 'member-documents', false)
    on conflict (id) do nothing;
  exception
    when undefined_table then
      null;
  end;
end
$$;
