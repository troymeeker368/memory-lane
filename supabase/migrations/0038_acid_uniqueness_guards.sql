-- ACID hardening: enforce uniqueness on critical in-flight workflows.
do $$
declare
  v_pof_request_groups integer := 0;
  v_physician_order_groups integer := 0;
  v_member_file_groups integer := 0;
begin
  select count(*)
  into v_pof_request_groups
  from (
    select physician_order_id
    from public.pof_requests
    where status in ('draft', 'sent', 'opened')
    group by physician_order_id
    having count(*) > 1
  ) duplicates;

  select count(*)
  into v_physician_order_groups
  from (
    select intake_assessment_id
    from public.physician_orders
    where intake_assessment_id is not null
      and status in ('draft', 'sent')
    group by intake_assessment_id
    having count(*) > 1
  ) duplicates;

  select count(*)
  into v_member_file_groups
  from (
    select pof_request_id
    from public.member_files
    where pof_request_id is not null
    group by pof_request_id
    having count(*) > 1
  ) duplicates;

  raise notice
    '0038 uniqueness preflight: % duplicate pof_request groups, % duplicate physician_order groups, % duplicate member_file groups.',
    v_pof_request_groups,
    v_physician_order_groups,
    v_member_file_groups;
end
$$;

with ranked as (
  select
    pr.id,
    pr.physician_order_id,
    row_number() over (
      partition by pr.physician_order_id
      order by
        case pr.status
          when 'opened' then 0
          when 'sent' then 1
          when 'draft' then 2
          else 3
        end,
        coalesce(pr.opened_at, pr.sent_at, pr.updated_at, pr.created_at) desc nulls last,
        pr.created_at desc nulls last,
        pr.id desc
    ) as duplicate_rank
  from public.pof_requests pr
  where pr.status in ('draft', 'sent', 'opened')
)
update public.pof_requests pr
set
  status = 'expired',
  expires_at = least(coalesce(pr.expires_at, now()), now()),
  updated_at = now()
from ranked
where pr.id = ranked.id
  and ranked.duplicate_rank > 1;

with ranked as (
  select
    po.id,
    po.intake_assessment_id,
    first_value(po.id) over (
      partition by po.intake_assessment_id
      order by
        case po.status
          when 'sent' then 0
          when 'draft' then 1
          else 2
        end,
        coalesce(po.sent_at, po.updated_at, po.created_at) desc nulls last,
        po.version_number desc,
        po.id desc
    ) as canonical_order_id,
    row_number() over (
      partition by po.intake_assessment_id
      order by
        case po.status
          when 'sent' then 0
          when 'draft' then 1
          else 2
        end,
        coalesce(po.sent_at, po.updated_at, po.created_at) desc nulls last,
        po.version_number desc,
        po.id desc
    ) as duplicate_rank
  from public.physician_orders po
  where po.intake_assessment_id is not null
    and po.status in ('draft', 'sent')
)
update public.physician_orders po
set
  status = 'superseded',
  superseded_by = ranked.canonical_order_id,
  superseded_at = coalesce(po.superseded_at, now()),
  is_active_signed = false,
  updated_at = now()
from ranked
where po.id = ranked.id
  and ranked.duplicate_rank > 1;

with ranked as (
  select
    mf.id,
    mf.pof_request_id,
    first_value(mf.id) over (
      partition by mf.pof_request_id
      order by
        case when pr.member_file_id = mf.id then 0 else 1 end,
        mf.updated_at desc nulls last,
        mf.uploaded_at desc nulls last,
        mf.id desc
    ) as canonical_member_file_id,
    row_number() over (
      partition by mf.pof_request_id
      order by
        case when pr.member_file_id = mf.id then 0 else 1 end,
        mf.updated_at desc nulls last,
        mf.uploaded_at desc nulls last,
        mf.id desc
    ) as duplicate_rank
  from public.member_files mf
  left join public.pof_requests pr
    on pr.id = mf.pof_request_id
  where mf.pof_request_id is not null
),
canonical_requests as (
  select distinct
    pof_request_id,
    canonical_member_file_id
  from ranked
)
update public.pof_requests pr
set
  member_file_id = canonical_requests.canonical_member_file_id,
  updated_at = now()
from canonical_requests
where pr.id = canonical_requests.pof_request_id
  and pr.member_file_id is distinct from canonical_requests.canonical_member_file_id;

with ranked as (
  select
    mf.id,
    mf.pof_request_id,
    row_number() over (
      partition by mf.pof_request_id
      order by
        case when pr.member_file_id = mf.id then 0 else 1 end,
        mf.updated_at desc nulls last,
        mf.uploaded_at desc nulls last,
        mf.id desc
    ) as duplicate_rank
  from public.member_files mf
  left join public.pof_requests pr
    on pr.id = mf.pof_request_id
  where mf.pof_request_id is not null
)
update public.member_files mf
set
  pof_request_id = null,
  document_source = case
    when coalesce(mf.document_source, '') like '%:legacy-detached-pof-request:%' then mf.document_source
    when nullif(trim(coalesce(mf.document_source, '')), '') is null then concat('legacy-detached-pof-request:', ranked.pof_request_id::text, ':', mf.id)
    else concat(mf.document_source, ':legacy-detached-pof-request:', ranked.pof_request_id::text, ':', mf.id)
  end,
  updated_at = now()
from ranked
where mf.id = ranked.id
  and ranked.duplicate_rank > 1;

do $$
declare
  v_remaining_pof_request_groups integer := 0;
  v_remaining_physician_order_groups integer := 0;
  v_remaining_member_file_groups integer := 0;
begin
  select count(*)
  into v_remaining_pof_request_groups
  from (
    select physician_order_id
    from public.pof_requests
    where status in ('draft', 'sent', 'opened')
    group by physician_order_id
    having count(*) > 1
  ) duplicates;

  select count(*)
  into v_remaining_physician_order_groups
  from (
    select intake_assessment_id
    from public.physician_orders
    where intake_assessment_id is not null
      and status in ('draft', 'sent')
    group by intake_assessment_id
    having count(*) > 1
  ) duplicates;

  select count(*)
  into v_remaining_member_file_groups
  from (
    select pof_request_id
    from public.member_files
    where pof_request_id is not null
    group by pof_request_id
    having count(*) > 1
  ) duplicates;

  if v_remaining_pof_request_groups > 0
    or v_remaining_physician_order_groups > 0
    or v_remaining_member_file_groups > 0 then
    raise exception
      '0038 abort: duplicates remain after cleanup (pof_requests %, physician_orders %, member_files %).',
      v_remaining_pof_request_groups,
      v_remaining_physician_order_groups,
      v_remaining_member_file_groups;
  end if;
end
$$;

create unique index if not exists idx_pof_requests_active_per_order_unique
  on public.pof_requests (physician_order_id)
  where status in ('draft', 'sent', 'opened');

create unique index if not exists idx_physician_orders_intake_draft_sent_unique
  on public.physician_orders (intake_assessment_id)
  where intake_assessment_id is not null
    and status in ('draft', 'sent');

create unique index if not exists idx_member_files_pof_request_unique
  on public.member_files (pof_request_id)
  where pof_request_id is not null;
