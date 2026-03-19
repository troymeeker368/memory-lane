update public.member_files
set document_source = nullif(trim(coalesce(document_source, '')), '')
where document_source is distinct from nullif(trim(coalesce(document_source, '')), '');

with ranked_duplicates as (
  select
    mf.id,
    mf.member_id,
    mf.document_source,
    mf.enrollment_packet_request_id,
    mf.pof_request_id,
    mf.care_plan_id,
    row_number() over (
      partition by mf.member_id, mf.document_source
      order by mf.updated_at desc, mf.uploaded_at desc, mf.id desc
    ) as duplicate_rank
  from public.member_files mf
  where mf.document_source is not null
),
upload_context as (
  select
    epu.member_file_id,
    min(epu.packet_id::text) as packet_id,
    min(epu.upload_category) as upload_category
  from public.enrollment_packet_uploads epu
  where epu.member_file_id is not null
  group by epu.member_file_id
)
update public.member_files mf
set
  document_source = concat(
    mf.document_source,
    ':legacy:',
    coalesce(
      case
        when uc.packet_id is not null then concat('packet-upload:', uc.packet_id, ':', coalesce(uc.upload_category, 'unknown'))
        when mf.enrollment_packet_request_id is not null then concat('enrollment-packet-request:', mf.enrollment_packet_request_id::text)
        when mf.pof_request_id is not null then concat('pof-request:', mf.pof_request_id::text)
        when mf.care_plan_id is not null then concat('care-plan:', mf.care_plan_id::text)
        else null
      end,
      mf.id
    )
  )
from ranked_duplicates rd
left join upload_context uc
  on uc.member_file_id = rd.id
where mf.id = rd.id
  and rd.duplicate_rank > 1;

drop index if exists public.idx_member_files_member_id_document_source;

create unique index if not exists idx_member_files_member_id_document_source
  on public.member_files (member_id, document_source)
  where document_source is not null;
