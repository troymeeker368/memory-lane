alter table public.progress_notes
  add column if not exists signature_attested boolean not null default false,
  add column if not exists signature_blob text,
  add column if not exists signature_metadata jsonb not null default '{}'::jsonb;
