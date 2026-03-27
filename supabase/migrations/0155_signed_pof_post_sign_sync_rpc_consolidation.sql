create or replace function public.rpc_run_signed_pof_post_sign_sync(
  p_pof_id uuid,
  p_sync_timestamp timestamptz default now()
)
returns table (
  member_id uuid,
  member_health_profile_id uuid,
  member_command_center_id text,
  anchor_physician_order_id uuid,
  synced_medications integer,
  inserted_schedules integer,
  patched_schedules integer,
  reactivated_schedules integer,
  deactivated_schedules integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.physician_orders%rowtype;
  v_sync_timestamp timestamptz := coalesce(p_sync_timestamp, now());
  v_schedule_start_date date;
  v_schedule_end_date date;
begin
  if p_pof_id is null then
    raise exception 'rpc_run_signed_pof_post_sign_sync requires p_pof_id';
  end if;

  select *
  into v_order
  from public.physician_orders as physician_orders
  where physician_orders.id = p_pof_id
  for update;

  if not found then
    raise exception 'Signed physician order % was not found for post-sign sync.', p_pof_id;
  end if;

  if coalesce(lower(v_order.status), '') <> 'signed' then
    raise exception 'Signed POF post-sign sync requires status=signed. Current status=%', coalesce(v_order.status, 'null');
  end if;

  perform pg_advisory_xact_lock(hashtext(v_order.member_id::text)::bigint);

  v_schedule_start_date := (v_sync_timestamp at time zone 'America/New_York')::date;
  v_schedule_end_date := v_schedule_start_date + 30;

  begin
    select
      sync.member_id,
      sync.member_health_profile_id,
      sync.member_command_center_id
    into
      member_id,
      member_health_profile_id,
      member_command_center_id
    from public.rpc_sync_signed_pof_to_member_clinical_profile(
      p_pof_id => p_pof_id,
      p_synced_at => v_sync_timestamp
    ) as sync;
  exception
    when others then
      raise exception 'mhp_mcc:%', SQLERRM using errcode = SQLSTATE;
  end;

  begin
    select
      reconcile.anchor_physician_order_id,
      reconcile.synced_medications,
      reconcile.inserted_schedules,
      reconcile.patched_schedules,
      reconcile.reactivated_schedules,
      reconcile.deactivated_schedules
    into
      anchor_physician_order_id,
      synced_medications,
      inserted_schedules,
      patched_schedules,
      reactivated_schedules,
      deactivated_schedules
    from public.rpc_reconcile_member_mar_state(
      p_member_id => v_order.member_id,
      p_start_date => v_schedule_start_date,
      p_end_date => v_schedule_end_date,
      p_preferred_physician_order_id => p_pof_id,
      p_now => v_sync_timestamp
    ) as reconcile;
  exception
    when others then
      raise exception 'mar_schedules:%', SQLERRM using errcode = SQLSTATE;
  end;

  if member_id is null or member_health_profile_id is null then
    raise exception 'Signed POF post-sign sync did not return canonical member/MHP identifiers for %.', p_pof_id;
  end if;

  if anchor_physician_order_id is null then
    raise exception 'Signed POF post-sign sync did not return a MAR anchor physician order for %.', p_pof_id;
  end if;

  return next;
end;
$$;

grant execute on function public.rpc_run_signed_pof_post_sign_sync(
  uuid,
  timestamptz
) to authenticated, service_role;
