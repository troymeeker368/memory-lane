alter table public.medication_orders
  drop constraint if exists medication_orders_order_source_check;

alter table public.medication_orders
  add constraint medication_orders_order_source_check
  check (order_source in ('pof', 'manual_provider_order', 'legacy_mhp', 'center_standing_order'));

create or replace function public.sync_center_standing_prn_orders_for_member(
  p_member_id uuid,
  p_member_status text default 'active',
  p_now timestamptz default now()
)
returns table (
  synced_orders integer,
  inactivated_orders integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_target_status text := case when lower(coalesce(trim(p_member_status), 'active')) = 'active' then 'active' else 'inactive' end;
  v_updated_count integer := 0;
  v_inserted_count integer := 0;
begin
  if p_member_id is null then
    raise exception 'Center standing PRN sync requires member_id.';
  end if;

  perform pg_advisory_xact_lock(hashtext(format('center-standing-prn:%s', p_member_id))::bigint);

  with templates as (
    select *
    from (
      values
        ('tylenol', 'Tylenol', '650mg', null::text, 'By mouth', 'Every 4 hrs for pain/fever', 'pain/fever', 'Every 4 hrs', 240, null::integer, null::numeric, 'Center Standing Order', false, true),
        ('ibuprofen', 'Ibuprofen', '200mg', null::text, 'By mouth', 'Every 8 hrs for pain', 'pain', 'Every 8 hrs', 480, null::integer, null::numeric, 'Center Standing Order', false, true),
        ('mylanta', 'Mylanta', '10mL', null::text, 'By mouth', 'Every 4 hrs for indigestion', 'indigestion', 'Every 4 hrs', 240, null::integer, null::numeric, 'Center Standing Order', false, true),
        ('benadryl', 'Benadryl', '25mg', null::text, 'By mouth', 'Every 6 hrs for itching', 'itching', 'Every 6 hrs', 360, null::integer, null::numeric, 'Center Standing Order', false, true)
    ) as template(
      template_id,
      medication_name,
      strength,
      form,
      route,
      directions,
      prn_reason,
      frequency_text,
      min_interval_minutes,
      max_doses_per_24h,
      max_daily_dose,
      provider_name,
      requires_review,
      requires_effectiveness_followup
    )
  )
  update public.medication_orders mo
  set
    source_medication_id = format('center-standing-prn:%s', template.template_id),
    order_type = 'prn',
    medication_name = template.medication_name,
    strength = template.strength,
    form = template.form,
    route = template.route,
    directions = template.directions,
    prn_reason = template.prn_reason,
    frequency_text = template.frequency_text,
    min_interval_minutes = template.min_interval_minutes,
    max_doses_per_24h = template.max_doses_per_24h,
    max_daily_dose = template.max_daily_dose,
    start_date = null,
    end_date = null,
    provider_name = template.provider_name,
    order_source = 'center_standing_order',
    status = v_target_status,
    requires_review = template.requires_review,
    requires_effectiveness_followup = template.requires_effectiveness_followup,
    created_by_name = 'System',
    source_payload = jsonb_build_object(
      'source', 'center_standing_order',
      'template_id', template.template_id,
      'seed_version', '0166_center_standing_prn_orders'
    ),
    updated_at = v_now
  from templates template
  where mo.member_id = p_member_id
    and mo.order_source = 'center_standing_order'
    and mo.source_medication_id = format('center-standing-prn:%s', template.template_id);

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  with templates as (
    select *
    from (
      values
        ('tylenol', 'Tylenol', '650mg', null::text, 'By mouth', 'Every 4 hrs for pain/fever', 'pain/fever', 'Every 4 hrs', 240, null::integer, null::numeric, 'Center Standing Order', false, true),
        ('ibuprofen', 'Ibuprofen', '200mg', null::text, 'By mouth', 'Every 8 hrs for pain', 'pain', 'Every 8 hrs', 480, null::integer, null::numeric, 'Center Standing Order', false, true),
        ('mylanta', 'Mylanta', '10mL', null::text, 'By mouth', 'Every 4 hrs for indigestion', 'indigestion', 'Every 4 hrs', 240, null::integer, null::numeric, 'Center Standing Order', false, true),
        ('benadryl', 'Benadryl', '25mg', null::text, 'By mouth', 'Every 6 hrs for itching', 'itching', 'Every 6 hrs', 360, null::integer, null::numeric, 'Center Standing Order', false, true)
    ) as template(
      template_id,
      medication_name,
      strength,
      form,
      route,
      directions,
      prn_reason,
      frequency_text,
      min_interval_minutes,
      max_doses_per_24h,
      max_daily_dose,
      provider_name,
      requires_review,
      requires_effectiveness_followup
    )
  )
  insert into public.medication_orders (
      member_id,
      physician_order_id,
      pof_medication_id,
      source_medication_id,
      order_type,
      medication_name,
      strength,
      form,
      route,
      directions,
      prn_reason,
      frequency_text,
      min_interval_minutes,
      max_doses_per_24h,
      max_daily_dose,
      start_date,
      end_date,
      provider_name,
      order_source,
      status,
      created_by,
      verified_by,
      requires_review,
      requires_effectiveness_followup,
      created_by_name,
      verified_by_name,
      source_payload,
      created_at,
      updated_at,
      creation_idempotency_key
    )
  select
    p_member_id,
    null,
    null,
    format('center-standing-prn:%s', template.template_id),
    'prn',
    template.medication_name,
    template.strength,
    template.form,
    template.route,
    template.directions,
    template.prn_reason,
    template.frequency_text,
    template.min_interval_minutes,
    template.max_doses_per_24h,
    template.max_daily_dose,
    null,
    null,
    template.provider_name,
    'center_standing_order',
    v_target_status,
    null,
    null,
    template.requires_review,
    template.requires_effectiveness_followup,
    'System',
    null,
    jsonb_build_object(
      'source', 'center_standing_order',
      'template_id', template.template_id,
      'seed_version', '0166_center_standing_prn_orders'
    ),
    v_now,
    v_now,
    format('center-standing-prn:%s:%s', p_member_id, template.template_id)
  from templates template
  where not exists (
    select 1
    from public.medication_orders mo
    where mo.member_id = p_member_id
      and mo.order_source = 'center_standing_order'
      and mo.source_medication_id = format('center-standing-prn:%s', template.template_id)
  );

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  synced_orders := v_updated_count + v_inserted_count;
  inactivated_orders := case when v_target_status = 'inactive' then synced_orders else 0 end;

  return next;
end;
$$;

create or replace function public.rpc_sync_center_standing_prn_orders(
  p_now timestamptz default now()
)
returns table (
  synced_orders integer,
  inactivated_orders integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with per_member as (
    select result.synced_orders, result.inactivated_orders
    from public.members member_row
    cross join lateral public.sync_center_standing_prn_orders_for_member(member_row.id, member_row.status, coalesce(p_now, now())) result
  )
  select
    coalesce(sum(per_member.synced_orders), 0)::integer,
    coalesce(sum(per_member.inactivated_orders), 0)::integer
  from per_member;
end;
$$;

create or replace function public.trg_members_sync_center_standing_prn_orders()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1
  from public.sync_center_standing_prn_orders_for_member(new.id, new.status, now());
  return new;
end;
$$;

drop trigger if exists trg_members_sync_center_standing_prn_orders on public.members;

create trigger trg_members_sync_center_standing_prn_orders
after insert or update of status on public.members
for each row
execute function public.trg_members_sync_center_standing_prn_orders();

revoke all on function public.rpc_sync_center_standing_prn_orders(timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.rpc_sync_center_standing_prn_orders(timestamptz) to authenticated, service_role;

select * from public.rpc_sync_center_standing_prn_orders(now());
