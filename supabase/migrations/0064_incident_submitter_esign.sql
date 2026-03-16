alter table public.incidents
  add column if not exists submitter_signature_name text,
  add column if not exists submitter_signed_at timestamptz;
