alter table public.member_contacts
  add column if not exists is_payor boolean default false;

update public.member_contacts
set
  is_payor = coalesce(is_payor, false),
  updated_at = now()
where is_payor is null;

do $$
declare
  v_duplicate_groups integer := 0;
begin
  select count(*)
  into v_duplicate_groups
  from (
    select member_id
    from public.member_contacts
    where is_payor = true
    group by member_id
    having count(*) > 1
  ) duplicates;

  raise notice
    '0068 member_contacts payor preflight: % members have duplicate payor flags before cleanup.',
    v_duplicate_groups;
end
$$;

with ranked as (
  select
    mc.id,
    row_number() over (
      partition by mc.member_id
      order by
        case
          when lower(btrim(coalesce(mc.category, ''))) = 'responsible party' then 0
          else 1
        end,
        mc.updated_at desc nulls last,
        mc.created_at desc nulls last,
        mc.id desc
    ) as duplicate_rank
  from public.member_contacts mc
  where mc.is_payor = true
)
update public.member_contacts mc
set
  is_payor = false,
  updated_at = now()
from ranked
where mc.id = ranked.id
  and ranked.duplicate_rank > 1;

do $$
declare
  v_remaining_duplicate_groups integer := 0;
begin
  select count(*)
  into v_remaining_duplicate_groups
  from (
    select member_id
    from public.member_contacts
    where is_payor = true
    group by member_id
    having count(*) > 1
  ) duplicates;

  if v_remaining_duplicate_groups > 0 then
    raise exception
      '0068 abort: % member_contacts payor duplicate groups remain after deterministic cleanup.',
      v_remaining_duplicate_groups;
  end if;
end
$$;

alter table public.member_contacts
  alter column is_payor set default false,
  alter column is_payor set not null;

create unique index if not exists idx_member_contacts_one_payor_per_member
  on public.member_contacts (member_id)
  where is_payor = true;

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
