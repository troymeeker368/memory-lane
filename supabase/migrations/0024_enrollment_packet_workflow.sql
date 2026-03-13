create table if not exists public.enrollment_packet_requests (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  sender_user_id uuid not null references public.profiles(id) on delete restrict,
  caregiver_email text not null,
  status text not null default 'draft' check (
    status in ('draft', 'prepared', 'sent', 'opened', 'partially_completed', 'completed', 'filed')
  ),
  token text not null,
  token_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_enrollment_packet_requests_token
  on public.enrollment_packet_requests(token);
create index if not exists idx_enrollment_packet_requests_member_created
  on public.enrollment_packet_requests(member_id, created_at desc);
create index if not exists idx_enrollment_packet_requests_lead_created
  on public.enrollment_packet_requests(lead_id, created_at desc);
create index if not exists idx_enrollment_packet_requests_sender_created
  on public.enrollment_packet_requests(sender_user_id, created_at desc);
create index if not exists idx_enrollment_packet_requests_status_expires
  on public.enrollment_packet_requests(status, token_expires_at);

create table if not exists public.enrollment_packet_fields (
  id uuid primary key default gen_random_uuid(),
  packet_id uuid not null unique references public.enrollment_packet_requests(id) on delete cascade,
  requested_days text[] not null default '{}'::text[],
  transportation text,
  community_fee numeric(10,2) not null default 0,
  daily_rate numeric(10,2) not null default 0,
  caregiver_name text,
  caregiver_phone text,
  caregiver_email text,
  caregiver_address_line1 text,
  caregiver_address_line2 text,
  caregiver_city text,
  caregiver_state text,
  caregiver_zip text,
  secondary_contact_name text,
  secondary_contact_phone text,
  secondary_contact_email text,
  secondary_contact_relationship text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.enrollment_packet_events (
  id uuid primary key default gen_random_uuid(),
  packet_id uuid not null references public.enrollment_packet_requests(id) on delete cascade,
  event_type text not null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_email text,
  event_timestamp timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists idx_enrollment_packet_events_packet_timestamp
  on public.enrollment_packet_events(packet_id, event_timestamp asc);
create index if not exists idx_enrollment_packet_events_type_timestamp
  on public.enrollment_packet_events(event_type, event_timestamp desc);

create table if not exists public.enrollment_packet_signatures (
  id uuid primary key default gen_random_uuid(),
  packet_id uuid not null references public.enrollment_packet_requests(id) on delete cascade,
  signer_name text not null,
  signer_email text,
  signer_role text not null check (signer_role in ('sender_staff', 'caregiver', 'witness', 'other')),
  signature_blob text not null,
  ip_address text,
  signed_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_enrollment_packet_signatures_packet_signed
  on public.enrollment_packet_signatures(packet_id, signed_at asc);

create table if not exists public.enrollment_packet_uploads (
  id uuid primary key default gen_random_uuid(),
  packet_id uuid not null references public.enrollment_packet_requests(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  file_path text not null,
  file_name text,
  file_type text not null,
  upload_category text not null default 'supporting' check (
    upload_category in ('insurance', 'poa', 'supporting', 'completed_packet', 'signature_artifact', 'other')
  ),
  member_file_id text references public.member_files(id) on delete set null,
  uploaded_at timestamptz not null default now()
);

create index if not exists idx_enrollment_packet_uploads_packet_uploaded
  on public.enrollment_packet_uploads(packet_id, uploaded_at asc);
create index if not exists idx_enrollment_packet_uploads_member_uploaded
  on public.enrollment_packet_uploads(member_id, uploaded_at desc);

alter table public.member_files
  add column if not exists enrollment_packet_request_id uuid references public.enrollment_packet_requests(id) on delete set null;

create index if not exists idx_member_files_enrollment_packet_request
  on public.member_files(enrollment_packet_request_id);

create table if not exists public.user_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  message text not null,
  entity_type text,
  entity_id text,
  read_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_user_notifications_recipient_created
  on public.user_notifications(recipient_user_id, created_at desc);
create index if not exists idx_user_notifications_unread
  on public.user_notifications(recipient_user_id, created_at desc)
  where read_at is null;

drop trigger if exists trg_enrollment_packet_requests_updated on public.enrollment_packet_requests;
create trigger trg_enrollment_packet_requests_updated
before update on public.enrollment_packet_requests
for each row execute function public.set_updated_at();

drop trigger if exists trg_enrollment_packet_fields_updated on public.enrollment_packet_fields;
create trigger trg_enrollment_packet_fields_updated
before update on public.enrollment_packet_fields
for each row execute function public.set_updated_at();

drop trigger if exists trg_enrollment_packet_signatures_updated on public.enrollment_packet_signatures;
create trigger trg_enrollment_packet_signatures_updated
before update on public.enrollment_packet_signatures
for each row execute function public.set_updated_at();

alter table public.enrollment_packet_requests enable row level security;
alter table public.enrollment_packet_fields enable row level security;
alter table public.enrollment_packet_events enable row level security;
alter table public.enrollment_packet_signatures enable row level security;
alter table public.enrollment_packet_uploads enable row level security;
alter table public.user_notifications enable row level security;

drop policy if exists "enrollment_packet_requests_select" on public.enrollment_packet_requests;
drop policy if exists "enrollment_packet_requests_insert" on public.enrollment_packet_requests;
drop policy if exists "enrollment_packet_requests_update" on public.enrollment_packet_requests;
create policy "enrollment_packet_requests_select" on public.enrollment_packet_requests
for select to authenticated using (true);
create policy "enrollment_packet_requests_insert" on public.enrollment_packet_requests
for insert to authenticated with check (true);
create policy "enrollment_packet_requests_update" on public.enrollment_packet_requests
for update to authenticated using (true) with check (true);

drop policy if exists "enrollment_packet_fields_select" on public.enrollment_packet_fields;
drop policy if exists "enrollment_packet_fields_insert" on public.enrollment_packet_fields;
drop policy if exists "enrollment_packet_fields_update" on public.enrollment_packet_fields;
create policy "enrollment_packet_fields_select" on public.enrollment_packet_fields
for select to authenticated using (true);
create policy "enrollment_packet_fields_insert" on public.enrollment_packet_fields
for insert to authenticated with check (true);
create policy "enrollment_packet_fields_update" on public.enrollment_packet_fields
for update to authenticated using (true) with check (true);

drop policy if exists "enrollment_packet_events_select" on public.enrollment_packet_events;
drop policy if exists "enrollment_packet_events_insert" on public.enrollment_packet_events;
create policy "enrollment_packet_events_select" on public.enrollment_packet_events
for select to authenticated using (true);
create policy "enrollment_packet_events_insert" on public.enrollment_packet_events
for insert to authenticated with check (true);

drop policy if exists "enrollment_packet_signatures_select" on public.enrollment_packet_signatures;
drop policy if exists "enrollment_packet_signatures_insert" on public.enrollment_packet_signatures;
drop policy if exists "enrollment_packet_signatures_update" on public.enrollment_packet_signatures;
create policy "enrollment_packet_signatures_select" on public.enrollment_packet_signatures
for select to authenticated using (true);
create policy "enrollment_packet_signatures_insert" on public.enrollment_packet_signatures
for insert to authenticated with check (true);
create policy "enrollment_packet_signatures_update" on public.enrollment_packet_signatures
for update to authenticated using (true) with check (true);

drop policy if exists "enrollment_packet_uploads_select" on public.enrollment_packet_uploads;
drop policy if exists "enrollment_packet_uploads_insert" on public.enrollment_packet_uploads;
drop policy if exists "enrollment_packet_uploads_update" on public.enrollment_packet_uploads;
create policy "enrollment_packet_uploads_select" on public.enrollment_packet_uploads
for select to authenticated using (true);
create policy "enrollment_packet_uploads_insert" on public.enrollment_packet_uploads
for insert to authenticated with check (true);
create policy "enrollment_packet_uploads_update" on public.enrollment_packet_uploads
for update to authenticated using (true) with check (true);

drop policy if exists "user_notifications_select" on public.user_notifications;
drop policy if exists "user_notifications_insert" on public.user_notifications;
drop policy if exists "user_notifications_update" on public.user_notifications;
create policy "user_notifications_select" on public.user_notifications
for select to authenticated using (true);
create policy "user_notifications_insert" on public.user_notifications
for insert to authenticated with check (true);
create policy "user_notifications_update" on public.user_notifications
for update to authenticated using (true) with check (true);
