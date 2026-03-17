alter table public.incidents
  add column if not exists submitter_signature_attested boolean not null default false,
  add column if not exists submitter_signature_artifact_storage_path text,
  add column if not exists final_pdf_member_file_id text references public.member_files(id) on delete set null,
  add column if not exists final_pdf_storage_object_path text,
  add column if not exists final_pdf_saved_at timestamptz;
