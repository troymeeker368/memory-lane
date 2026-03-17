alter table public.member_contacts
  add column if not exists is_payor boolean not null default false;

create or replace function public.rpc_set_member_contact_payor(
  p_member_id uuid,
  p_contact_id text default null
)
returns table (
  member_id uuid,
  contact_id text,
  is_payor boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contact_id text := nullif(trim(coalesce(p_contact_id, '')), '');
  v_existing_contact_id text;
begin
  if p_member_id is null then
    raise exception 'rpc_set_member_contact_payor requires p_member_id';
  end if;

  if v_contact_id is not null then
    select id
    into v_existing_contact_id
    from public.member_contacts
    where id = v_contact_id
      and member_id = p_member_id
    for update;

    if v_existing_contact_id is null then
      raise exception 'Contact % does not belong to member %.', v_contact_id, p_member_id;
    end if;
  end if;

  update public.member_contacts
  set
    is_payor = false,
    updated_at = now()
  where member_id = p_member_id
    and is_payor = true
    and (v_contact_id is null or id <> v_contact_id);

  if v_contact_id is not null then
    update public.member_contacts
    set
      is_payor = true,
      updated_at = now()
    where member_id = p_member_id
      and id = v_contact_id;
  end if;

  return query
  select
    p_member_id,
    v_contact_id,
    v_contact_id is not null;
end;
$$;

grant execute on function public.rpc_set_member_contact_payor(uuid, text) to authenticated, service_role;

with exact_responsible_party as (
  select
    member_id,
    max(id) as contact_id
  from public.member_contacts
  where lower(btrim(category)) = 'responsible party'
  group by member_id
  having count(*) = 1
)
update public.member_contacts contacts
set
  is_payor = true,
  updated_at = now()
from exact_responsible_party responsible
where contacts.id = responsible.contact_id
  and not exists (
    select 1
    from public.member_contacts existing
    where existing.member_id = responsible.member_id
      and existing.is_payor = true
  );

with latest_active_setting as (
  select distinct on (settings.member_id)
    settings.member_id,
    settings.payor_id
  from public.member_billing_settings settings
  where settings.active = true
    and settings.payor_id is not null
  order by
    settings.member_id,
    settings.effective_start_date desc,
    settings.updated_at desc
),
legacy_payor_match as (
  select
    setting.member_id,
    min(contacts.id) as contact_id
  from latest_active_setting setting
  join public.payors payors
    on payors.id = setting.payor_id
  join public.member_contacts contacts
    on contacts.member_id = setting.member_id
   and (
     lower(btrim(coalesce(contacts.contact_name, ''))) = lower(btrim(coalesce(payors.billing_contact_name, payors.payor_name, '')))
     or (
       nullif(lower(btrim(coalesce(payors.billing_email, ''))), '') is not null
       and lower(btrim(coalesce(contacts.email, ''))) = lower(btrim(payors.billing_email))
     )
     or (
       nullif(regexp_replace(coalesce(payors.billing_phone, ''), '\D', '', 'g'), '') is not null
       and regexp_replace(coalesce(contacts.cellular_number, contacts.work_number, contacts.home_number, ''), '\D', '', 'g') =
         regexp_replace(coalesce(payors.billing_phone, ''), '\D', '', 'g')
     )
   )
  group by setting.member_id
  having count(distinct contacts.id) = 1
)
update public.member_contacts contacts
set
  is_payor = true,
  updated_at = now()
from legacy_payor_match matched
where contacts.id = matched.contact_id
  and not exists (
    select 1
    from public.member_contacts existing
    where existing.member_id = matched.member_id
      and existing.is_payor = true
  );

create unique index if not exists idx_member_contacts_one_payor_per_member
  on public.member_contacts (member_id)
  where is_payor = true;

create or replace view public.billing_payor_backfill_review as
with current_flags as (
  select
    member_id,
    count(*) as flagged_payor_count
  from public.member_contacts
  where is_payor = true
  group by member_id
),
latest_active_setting as (
  select distinct on (settings.member_id)
    settings.member_id,
    settings.payor_id
  from public.member_billing_settings settings
  where settings.active = true
    and settings.payor_id is not null
  order by
    settings.member_id,
    settings.effective_start_date desc,
    settings.updated_at desc
),
legacy_matches as (
  select
    setting.member_id,
    setting.payor_id,
    payors.payor_name,
    payors.billing_contact_name,
    array_remove(array_agg(distinct contacts.id), null) as matching_contact_ids,
    array_remove(array_agg(distinct contacts.contact_name), null) as matching_contact_names
  from latest_active_setting setting
  join public.payors payors
    on payors.id = setting.payor_id
  left join public.member_contacts contacts
    on contacts.member_id = setting.member_id
   and (
     lower(btrim(coalesce(contacts.contact_name, ''))) = lower(btrim(coalesce(payors.billing_contact_name, payors.payor_name, '')))
     or (
       nullif(lower(btrim(coalesce(payors.billing_email, ''))), '') is not null
       and lower(btrim(coalesce(contacts.email, ''))) = lower(btrim(payors.billing_email))
     )
     or (
       nullif(regexp_replace(coalesce(payors.billing_phone, ''), '\D', '', 'g'), '') is not null
       and regexp_replace(coalesce(contacts.cellular_number, contacts.work_number, contacts.home_number, ''), '\D', '', 'g') =
         regexp_replace(coalesce(payors.billing_phone, ''), '\D', '', 'g')
     )
   )
  group by
    setting.member_id,
    setting.payor_id,
    payors.payor_name,
    payors.billing_contact_name
)
select
  members.id as member_id,
  members.display_name as member_name,
  legacy.payor_id as legacy_payor_id,
  legacy.payor_name as legacy_payor_name,
  legacy.billing_contact_name as legacy_billing_contact_name,
  legacy.matching_contact_ids,
  legacy.matching_contact_names,
  coalesce(flags.flagged_payor_count, 0) as flagged_payor_count,
  case
    when coalesce(flags.flagged_payor_count, 0) > 1 then 'multiple_payor_contacts'
    when legacy.payor_id is not null and cardinality(coalesce(legacy.matching_contact_ids, array[]::text[])) = 0 then 'legacy_payor_has_no_contact_match'
    when legacy.payor_id is not null and cardinality(coalesce(legacy.matching_contact_ids, array[]::text[])) > 1 then 'legacy_payor_matches_multiple_contacts'
    when legacy.payor_id is not null and coalesce(flags.flagged_payor_count, 0) = 0 then 'legacy_payor_requires_manual_review'
    else null
  end as review_reason
from public.members members
left join current_flags flags
  on flags.member_id = members.id
left join legacy_matches legacy
  on legacy.member_id = members.id
where
  coalesce(flags.flagged_payor_count, 0) > 1
  or (
    legacy.payor_id is not null
    and (
      cardinality(coalesce(legacy.matching_contact_ids, array[]::text[])) <> 1
      or coalesce(flags.flagged_payor_count, 0) = 0
    )
  );
