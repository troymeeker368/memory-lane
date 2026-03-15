create unique index if not exists idx_member_files_mcc_manual_upload_unique
  on public.member_files (member_id, document_source)
  where document_source is not null
    and document_source like 'mcc_manual_upload:%';
