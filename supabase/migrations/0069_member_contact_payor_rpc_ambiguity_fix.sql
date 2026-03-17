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
    select mc.id
    into v_existing_contact_id
    from public.member_contacts as mc
    where mc.id = v_contact_id
      and mc.member_id = p_member_id
    for update;

    if v_existing_contact_id is null then
      raise exception 'Contact % does not belong to member %.', v_contact_id, p_member_id;
    end if;
  end if;

  update public.member_contacts as mc
  set
    is_payor = false,
    updated_at = now()
  where mc.member_id = p_member_id
    and mc.is_payor = true
    and (v_contact_id is null or mc.id <> v_contact_id);

  if v_contact_id is not null then
    update public.member_contacts as mc
    set
      is_payor = true,
      updated_at = now()
    where mc.member_id = p_member_id
      and mc.id = v_contact_id;
  end if;

  return query
  select
    p_member_id as member_id,
    v_contact_id as contact_id,
    (v_contact_id is not null) as is_payor;
end;
$$;

grant execute on function public.rpc_set_member_contact_payor(uuid, text) to authenticated, service_role;
