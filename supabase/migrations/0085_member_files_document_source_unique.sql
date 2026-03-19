update public.member_files
set document_source = nullif(trim(coalesce(document_source, '')), '')
where document_source is distinct from nullif(trim(coalesce(document_source, '')), '');

do $$
declare
  v_duplicate record;
begin
  select
    member_id,
    trim(document_source) as document_source,
    count(*) as duplicate_count,
    array_agg(id order by updated_at desc, uploaded_at desc, id desc) as member_file_ids
  into v_duplicate
  from public.member_files
  where document_source is not null
  group by member_id, trim(document_source)
  having count(*) > 1
  order by count(*) desc, member_id
  limit 1;

  if found then
    raise exception
      'member_files duplicate document_source rows detected for member_id %, document_source %, ids %, count %. Resolve the duplicate canonical artifacts before applying migration 0085_member_files_document_source_unique.sql.',
      v_duplicate.member_id,
      v_duplicate.document_source,
      v_duplicate.member_file_ids,
      v_duplicate.duplicate_count;
  end if;
end
$$;

drop index if exists public.idx_member_files_member_id_document_source;

create unique index if not exists idx_member_files_member_id_document_source
  on public.member_files (member_id, document_source)
  where document_source is not null;
