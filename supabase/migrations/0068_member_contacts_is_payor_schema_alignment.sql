alter table public.member_contacts
  add column if not exists is_payor boolean not null default false;

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
