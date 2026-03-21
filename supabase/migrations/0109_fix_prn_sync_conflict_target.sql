drop index if exists public.uniq_medication_orders_pof_source;

create unique index if not exists uniq_medication_orders_pof_source
  on public.medication_orders (physician_order_id, source_medication_id);

create or replace function public.rpc_sync_active_prn_medication_orders(
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
  v_inactivated_current integer := 0;
  v_inactivated_stale integer := 0;
begin
  with active_signed_orders as (
    select
      po.id,
      po.member_id,
      po.provider_name,
      po.created_by_user_id,
      po.created_by_name,
      po.updated_by_user_id,
      po.updated_by_name,
      po.medications
    from public.physician_orders po
    where po.status = 'signed'
      and coalesce(po.is_active_signed, false) = true
  ), source_rows as (
    select
      aso.member_id,
      aso.id as physician_order_id,
      pm.id as pof_medication_id,
      src.source_medication_id,
      nullif(trim(src.item ->> 'name'), '') as medication_name,
      coalesce(nullif(trim(src.item ->> 'strength'), ''), nullif(trim(src.item ->> 'quantity'), ''), pm.strength) as strength,
      nullif(trim(src.item ->> 'form'), '') as form,
      nullif(trim(src.item ->> 'route'), '') as route,
      coalesce(nullif(trim(src.item ->> 'instructions'), ''), nullif(trim(src.item ->> 'comments'), ''), pm.instructions) as directions,
      nullif(trim(src.item ->> 'prnInstructions'), '') as prn_reason,
      nullif(trim(src.item ->> 'frequency'), '') as frequency_text,
      nullif(trim(src.item ->> 'startDate'), '')::date as start_date,
      nullif(trim(src.item ->> 'endDate'), '')::date as end_date,
      coalesce(nullif(trim(src.item ->> 'provider'), ''), pm.provider, aso.provider_name) as provider_name,
      case
        when coalesce(nullif(trim(src.item ->> 'active'), '')::boolean, true) = false then 'inactive'
        when nullif(trim(src.item ->> 'endDate'), '')::date is not null and nullif(trim(src.item ->> 'endDate'), '')::date < (v_now at time zone 'America/New_York')::date then 'expired'
        else 'active'
      end as status,
      aso.created_by_user_id as created_by,
      aso.updated_by_user_id as verified_by,
      aso.created_by_name,
      aso.updated_by_name as verified_by_name,
      jsonb_build_object(
        'source', 'pof',
        'physician_order_id', aso.id,
        'source_medication_id', src.source_medication_id,
        'medication_json', src.item
      ) as source_payload
    from active_signed_orders aso
    cross join lateral (
      select
        med.item,
        coalesce(nullif(trim(med.item ->> 'id'), ''), format('medication-%s', med.ordinality)) as source_medication_id
      from jsonb_array_elements(coalesce(aso.medications, '[]'::jsonb)) with ordinality as med(item, ordinality)
    ) src
    left join public.pof_medications pm
      on pm.physician_order_id = aso.id
     and pm.source_medication_id = src.source_medication_id
    where nullif(trim(src.item ->> 'name'), '') is not null
      and coalesce(nullif(trim(src.item ->> 'prn'), '')::boolean, false) = true
      and coalesce(nullif(trim(src.item ->> 'givenAtCenter'), '')::boolean, false) = true
  ), upserted as (
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
      updated_at
    )
    select
      source_rows.member_id,
      source_rows.physician_order_id,
      source_rows.pof_medication_id,
      source_rows.source_medication_id,
      'prn',
      source_rows.medication_name,
      source_rows.strength,
      source_rows.form,
      source_rows.route,
      source_rows.directions,
      source_rows.prn_reason,
      source_rows.frequency_text,
      source_rows.start_date,
      source_rows.end_date,
      source_rows.provider_name,
      'pof',
      source_rows.status,
      source_rows.created_by,
      source_rows.verified_by,
      false,
      true,
      source_rows.created_by_name,
      source_rows.verified_by_name,
      source_rows.source_payload,
      v_now,
      v_now
    from source_rows
    on conflict (physician_order_id, source_medication_id)
    do update
    set
      member_id = excluded.member_id,
      pof_medication_id = excluded.pof_medication_id,
      medication_name = excluded.medication_name,
      strength = excluded.strength,
      form = excluded.form,
      route = excluded.route,
      directions = excluded.directions,
      prn_reason = excluded.prn_reason,
      frequency_text = excluded.frequency_text,
      start_date = excluded.start_date,
      end_date = excluded.end_date,
      provider_name = excluded.provider_name,
      order_source = excluded.order_source,
      status = excluded.status,
      verified_by = excluded.verified_by,
      requires_effectiveness_followup = excluded.requires_effectiveness_followup,
      verified_by_name = excluded.verified_by_name,
      source_payload = excluded.source_payload,
      updated_at = excluded.updated_at
    returning 1
  )
  select count(*) into synced_orders from upserted;

  update public.medication_orders mo
  set
    status = case
      when mo.end_date is not null and mo.end_date < (v_now at time zone 'America/New_York')::date then 'expired'
      else 'inactive'
    end,
    updated_at = v_now
  where mo.order_source = 'pof'
    and exists (
      select 1
      from public.physician_orders po
      where po.id = mo.physician_order_id
        and po.status = 'signed'
        and coalesce(po.is_active_signed, false) = true
    )
    and not exists (
      select 1
      from public.physician_orders po
      cross join lateral jsonb_array_elements(coalesce(po.medications, '[]'::jsonb)) with ordinality as med(item, ordinality)
      where po.id = mo.physician_order_id
        and po.status = 'signed'
        and coalesce(po.is_active_signed, false) = true
        and coalesce(nullif(trim(med.item ->> 'id'), ''), format('medication-%s', med.ordinality)) = mo.source_medication_id
        and nullif(trim(med.item ->> 'name'), '') is not null
        and coalesce(nullif(trim(med.item ->> 'prn'), '')::boolean, false) = true
        and coalesce(nullif(trim(med.item ->> 'givenAtCenter'), '')::boolean, false) = true
    );
  get diagnostics v_inactivated_current = row_count;

  update public.medication_orders mo
  set
    status = case
      when mo.end_date is not null and mo.end_date < (v_now at time zone 'America/New_York')::date then 'expired'
      else 'inactive'
    end,
    updated_at = v_now
  where mo.order_source = 'pof'
    and not exists (
      select 1
      from public.physician_orders po
      where po.id = mo.physician_order_id
        and po.status = 'signed'
        and coalesce(po.is_active_signed, false) = true
    );
  get diagnostics v_inactivated_stale = row_count;

  inactivated_orders := v_inactivated_current + v_inactivated_stale;
  return next;
end;
$$;

grant execute on function public.rpc_sync_active_prn_medication_orders(timestamptz) to authenticated, service_role;
