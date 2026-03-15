create or replace function public.rpc_generate_billing_batch(
  p_batch jsonb,
  p_invoices jsonb default '[]'::jsonb,
  p_invoice_lines jsonb default '[]'::jsonb,
  p_coverages jsonb default '[]'::jsonb,
  p_source_updates jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_source_update jsonb;
begin
  v_batch_id := nullif(p_batch ->> 'id', '')::uuid;
  if v_batch_id is null then
    raise exception 'billing batch id is required';
  end if;

  insert into public.billing_batches (
    id,
    batch_type,
    billing_month,
    run_date,
    batch_status,
    invoice_count,
    total_amount,
    completion_date,
    next_due_date,
    generated_by_user_id,
    generated_by_name,
    created_at,
    updated_at
  )
  values (
    v_batch_id,
    nullif(p_batch ->> 'batch_type', ''),
    nullif(p_batch ->> 'billing_month', '')::date,
    nullif(p_batch ->> 'run_date', '')::date,
    coalesce(nullif(p_batch ->> 'batch_status', ''), 'Draft'),
    coalesce(nullif(p_batch ->> 'invoice_count', '')::integer, 0),
    coalesce(nullif(p_batch ->> 'total_amount', '')::numeric, 0),
    nullif(p_batch ->> 'completion_date', '')::date,
    nullif(p_batch ->> 'next_due_date', '')::date,
    nullif(p_batch ->> 'generated_by_user_id', '')::uuid,
    nullif(p_batch ->> 'generated_by_name', ''),
    coalesce(nullif(p_batch ->> 'created_at', '')::timestamptz, now()),
    coalesce(nullif(p_batch ->> 'updated_at', '')::timestamptz, now())
  );

  insert into public.billing_invoices (
    id,
    billing_batch_id,
    member_id,
    payor_id,
    invoice_number,
    invoice_month,
    invoice_source,
    invoice_status,
    export_status,
    billing_mode_snapshot,
    monthly_billing_basis_snapshot,
    transportation_billing_status_snapshot,
    billing_method_snapshot,
    base_period_start,
    base_period_end,
    variable_charge_period_start,
    variable_charge_period_end,
    invoice_date,
    due_date,
    base_program_billed_days,
    member_daily_rate_snapshot,
    base_program_amount,
    transportation_amount,
    ancillary_amount,
    adjustment_amount,
    total_amount,
    notes,
    created_by_user_id,
    created_by_name,
    created_at,
    updated_at
  )
  select
    nullif(value ->> 'id', '')::uuid,
    v_batch_id,
    nullif(value ->> 'member_id', '')::uuid,
    nullif(value ->> 'payor_id', ''),
    nullif(value ->> 'invoice_number', ''),
    nullif(value ->> 'invoice_month', '')::date,
    coalesce(nullif(value ->> 'invoice_source', ''), 'BatchGenerated'),
    coalesce(nullif(value ->> 'invoice_status', ''), 'Draft'),
    coalesce(nullif(value ->> 'export_status', ''), 'NotExported'),
    nullif(value ->> 'billing_mode_snapshot', ''),
    nullif(value ->> 'monthly_billing_basis_snapshot', ''),
    nullif(value ->> 'transportation_billing_status_snapshot', ''),
    nullif(value ->> 'billing_method_snapshot', ''),
    nullif(value ->> 'base_period_start', '')::date,
    nullif(value ->> 'base_period_end', '')::date,
    nullif(value ->> 'variable_charge_period_start', '')::date,
    nullif(value ->> 'variable_charge_period_end', '')::date,
    nullif(value ->> 'invoice_date', '')::date,
    nullif(value ->> 'due_date', '')::date,
    coalesce(nullif(value ->> 'base_program_billed_days', '')::numeric, 0),
    coalesce(nullif(value ->> 'member_daily_rate_snapshot', '')::numeric, 0),
    coalesce(nullif(value ->> 'base_program_amount', '')::numeric, 0),
    coalesce(nullif(value ->> 'transportation_amount', '')::numeric, 0),
    coalesce(nullif(value ->> 'ancillary_amount', '')::numeric, 0),
    coalesce(nullif(value ->> 'adjustment_amount', '')::numeric, 0),
    coalesce(nullif(value ->> 'total_amount', '')::numeric, 0),
    nullif(value ->> 'notes', ''),
    nullif(value ->> 'created_by_user_id', '')::uuid,
    nullif(value ->> 'created_by_name', ''),
    coalesce(nullif(value ->> 'created_at', '')::timestamptz, now()),
    coalesce(nullif(value ->> 'updated_at', '')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_invoices, '[]'::jsonb)) value;

  insert into public.billing_invoice_lines (
    id,
    invoice_id,
    member_id,
    payor_id,
    service_date,
    service_period_start,
    service_period_end,
    line_type,
    description,
    quantity,
    unit_rate,
    amount,
    source_table,
    source_record_id,
    billing_status,
    created_at,
    updated_at
  )
  select
    nullif(value ->> 'id', '')::uuid,
    nullif(value ->> 'invoice_id', '')::uuid,
    nullif(value ->> 'member_id', '')::uuid,
    nullif(value ->> 'payor_id', ''),
    nullif(value ->> 'service_date', '')::date,
    nullif(value ->> 'service_period_start', '')::date,
    nullif(value ->> 'service_period_end', '')::date,
    nullif(value ->> 'line_type', ''),
    nullif(value ->> 'description', ''),
    coalesce(nullif(value ->> 'quantity', '')::numeric, 0),
    coalesce(nullif(value ->> 'unit_rate', '')::numeric, 0),
    coalesce(nullif(value ->> 'amount', '')::numeric, 0),
    nullif(value ->> 'source_table', ''),
    nullif(value ->> 'source_record_id', ''),
    coalesce(nullif(value ->> 'billing_status', ''), 'Billed'),
    coalesce(nullif(value ->> 'created_at', '')::timestamptz, now()),
    coalesce(nullif(value ->> 'updated_at', '')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_invoice_lines, '[]'::jsonb)) value;

  for v_source_update in
    select value
    from jsonb_array_elements(coalesce(p_source_updates, '[]'::jsonb)) value
  loop
    if v_source_update ->> 'source_table' = 'transportation_logs' then
      update public.transportation_logs
      set
        billing_status = 'Billed',
        billing_exclusion_reason = null,
        invoice_id = nullif(v_source_update ->> 'invoice_id', '')::uuid,
        updated_at = coalesce(nullif(v_source_update ->> 'updated_at', '')::timestamptz, now())
      where id = nullif(v_source_update ->> 'source_record_id', '');
      if not found then
        raise exception 'transportation log % was not found during billing batch generation', v_source_update ->> 'source_record_id';
      end if;
    elsif v_source_update ->> 'source_table' = 'ancillary_charge_logs' then
      update public.ancillary_charge_logs
      set
        billing_status = 'Billed',
        billing_exclusion_reason = null,
        invoice_id = nullif(v_source_update ->> 'invoice_id', '')::uuid,
        updated_at = coalesce(nullif(v_source_update ->> 'updated_at', '')::timestamptz, now())
      where id = nullif(v_source_update ->> 'source_record_id', '');
      if not found then
        raise exception 'ancillary charge log % was not found during billing batch generation', v_source_update ->> 'source_record_id';
      end if;
    elsif v_source_update ->> 'source_table' = 'billing_adjustments' then
      update public.billing_adjustments
      set
        billing_status = 'Billed',
        exclusion_reason = null,
        invoice_id = nullif(v_source_update ->> 'invoice_id', '')::uuid,
        updated_at = coalesce(nullif(v_source_update ->> 'updated_at', '')::timestamptz, now())
      where id = nullif(v_source_update ->> 'source_record_id', '')::uuid;
      if not found then
        raise exception 'billing adjustment % was not found during billing batch generation', v_source_update ->> 'source_record_id';
      end if;
    else
      raise exception 'unsupported billing source table %', coalesce(v_source_update ->> 'source_table', 'null');
    end if;
  end loop;

  insert into public.billing_coverages (
    member_id,
    coverage_type,
    coverage_start_date,
    coverage_end_date,
    source_invoice_id,
    source_invoice_line_id,
    source_table,
    source_record_id,
    created_at
  )
  select
    nullif(value ->> 'member_id', '')::uuid,
    nullif(value ->> 'coverage_type', ''),
    nullif(value ->> 'coverage_start_date', '')::date,
    nullif(value ->> 'coverage_end_date', '')::date,
    nullif(value ->> 'source_invoice_id', '')::uuid,
    nullif(value ->> 'source_invoice_line_id', '')::uuid,
    nullif(value ->> 'source_table', ''),
    nullif(value ->> 'source_record_id', ''),
    coalesce(nullif(value ->> 'created_at', '')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_coverages, '[]'::jsonb)) value;

  return v_batch_id;
end;
$$;

create or replace function public.rpc_create_billing_export(
  p_export_job jsonb,
  p_invoice_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_export_id uuid := nullif(p_export_job ->> 'id', '')::uuid;
  v_batch_id uuid := nullif(p_export_job ->> 'billing_batch_id', '')::uuid;
  v_now timestamptz := coalesce(nullif(p_export_job ->> 'updated_at', '')::timestamptz, now());
begin
  if v_export_id is null then
    raise exception 'billing export id is required';
  end if;
  if v_batch_id is null then
    raise exception 'billing batch id is required for export generation';
  end if;

  insert into public.billing_export_jobs (
    id,
    billing_batch_id,
    export_type,
    quickbooks_detail_level,
    file_name,
    file_data_url,
    generated_at,
    generated_by,
    status,
    notes,
    created_at,
    updated_at
  )
  values (
    v_export_id,
    v_batch_id,
    nullif(p_export_job ->> 'export_type', ''),
    coalesce(nullif(p_export_job ->> 'quickbooks_detail_level', ''), 'Summary'),
    nullif(p_export_job ->> 'file_name', ''),
    nullif(p_export_job ->> 'file_data_url', ''),
    coalesce(nullif(p_export_job ->> 'generated_at', '')::timestamptz, now()),
    nullif(p_export_job ->> 'generated_by', ''),
    coalesce(nullif(p_export_job ->> 'status', ''), 'Generated'),
    nullif(p_export_job ->> 'notes', ''),
    coalesce(nullif(p_export_job ->> 'created_at', '')::timestamptz, now()),
    v_now
  );

  update public.billing_batches
  set
    batch_status = 'Exported',
    updated_at = v_now
  where id = v_batch_id;
  if not found then
    raise exception 'billing batch % was not found for export generation', v_batch_id;
  end if;

  update public.billing_invoices
  set
    export_status = 'Exported',
    updated_at = v_now
  where id = any(coalesce(p_invoice_ids, array[]::uuid[]));

  return v_export_id;
end;
$$;

create or replace function public.rpc_finalize_enrollment_packet_request_completion(
  p_packet_id uuid,
  p_rotated_token text,
  p_completed_at timestamptz,
  p_filed_at timestamptz,
  p_signer_name text,
  p_signer_email text,
  p_signature_blob text,
  p_ip_address text,
  p_actor_user_id uuid,
  p_actor_email text,
  p_completed_metadata jsonb default '{}'::jsonb,
  p_filed_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.enrollment_packet_requests%rowtype;
begin
  if p_packet_id is null then
    raise exception 'packet id is required';
  end if;

  select *
  into v_request
  from public.enrollment_packet_requests
  where id = p_packet_id
  for update;

  if not found then
    raise exception 'Enrollment packet request % was not found.', p_packet_id;
  end if;

  if coalesce(v_request.status, '') in ('completed', 'filed') then
    raise exception 'Enrollment packet request % has already been finalized.', p_packet_id;
  end if;

  if coalesce(v_request.status, '') not in ('prepared', 'sent', 'opened', 'partially_completed') then
    raise exception 'Enrollment packet request % cannot be finalized from status %.', p_packet_id, coalesce(v_request.status, 'null');
  end if;

  insert into public.enrollment_packet_signatures (
    packet_id,
    signer_name,
    signer_email,
    signer_role,
    signature_blob,
    ip_address,
    signed_at,
    created_at,
    updated_at
  )
  values (
    p_packet_id,
    p_signer_name,
    nullif(p_signer_email, ''),
    'caregiver',
    p_signature_blob,
    nullif(p_ip_address, ''),
    coalesce(p_completed_at, now()),
    coalesce(p_completed_at, now()),
    coalesce(p_completed_at, now())
  );

  update public.enrollment_packet_requests
  set
    status = 'filed',
    completed_at = coalesce(p_completed_at, now()),
    token = p_rotated_token,
    updated_at = coalesce(p_filed_at, now())
  where id = p_packet_id;

  insert into public.enrollment_packet_events (
    packet_id,
    event_type,
    actor_user_id,
    actor_email,
    timestamp,
    metadata
  )
  values
    (
      p_packet_id,
      'Enrollment Packet Completed',
      null,
      nullif(p_actor_email, ''),
      coalesce(p_completed_at, now()),
      coalesce(p_completed_metadata, '{}'::jsonb)
    ),
    (
      p_packet_id,
      'filed',
      p_actor_user_id,
      null,
      coalesce(p_filed_at, now()),
      coalesce(p_filed_metadata, '{}'::jsonb)
    );

  return p_packet_id;
end;
$$;

create or replace function public.rpc_finalize_care_plan_caregiver_signature(
  p_care_plan_id uuid,
  p_rotated_token text,
  p_signed_at timestamptz,
  p_updated_at timestamptz,
  p_final_member_file_id text,
  p_actor_name text,
  p_actor_email text,
  p_actor_ip text,
  p_actor_user_agent text,
  p_signature_image_url text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_care_plan public.care_plans%rowtype;
begin
  if p_care_plan_id is null then
    raise exception 'care plan id is required';
  end if;

  select *
  into v_care_plan
  from public.care_plans
  where id = p_care_plan_id
  for update;

  if not found then
    raise exception 'Care plan % was not found.', p_care_plan_id;
  end if;

  if coalesce(v_care_plan.caregiver_signature_status, '') = 'signed' then
    raise exception 'Care plan % caregiver signature is already finalized.', p_care_plan_id;
  end if;

  if coalesce(v_care_plan.caregiver_signature_status, '') not in ('sent', 'viewed') then
    raise exception 'Care plan % caregiver signature cannot be finalized from status %.', p_care_plan_id, coalesce(v_care_plan.caregiver_signature_status, 'null');
  end if;

  update public.care_plans
  set
    caregiver_signature_status = 'signed',
    caregiver_signed_at = coalesce(p_signed_at, now()),
    caregiver_signature_request_token = p_rotated_token,
    caregiver_signature_request_url = null,
    final_member_file_id = nullif(p_final_member_file_id, ''),
    caregiver_signature_error = null,
    updated_at = coalesce(p_updated_at, now())
  where id = p_care_plan_id;

  insert into public.care_plan_signature_events (
    care_plan_id,
    member_id,
    event_type,
    actor_type,
    actor_name,
    actor_email,
    actor_ip,
    actor_user_agent,
    metadata,
    created_at
  )
  values (
    p_care_plan_id,
    v_care_plan.member_id,
    'signed',
    'caregiver',
    nullif(p_actor_name, ''),
    nullif(p_actor_email, ''),
    nullif(p_actor_ip, ''),
    nullif(p_actor_user_agent, ''),
    jsonb_strip_nulls(
      jsonb_build_object(
        'finalMemberFileId', nullif(p_final_member_file_id, ''),
        'signatureImageUrl', nullif(p_signature_image_url, '')
      )
    ) || coalesce(p_metadata, '{}'::jsonb),
    coalesce(p_signed_at, now())
  );

  return p_care_plan_id;
end;
$$;

grant execute on function public.rpc_generate_billing_batch(jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.rpc_create_billing_export(jsonb, uuid[]) to authenticated, service_role;
grant execute on function public.rpc_finalize_enrollment_packet_request_completion(
  uuid,
  text,
  timestamptz,
  timestamptz,
  text,
  text,
  text,
  text,
  uuid,
  text,
  jsonb,
  jsonb
) to authenticated, service_role;
grant execute on function public.rpc_finalize_care_plan_caregiver_signature(
  uuid,
  text,
  timestamptz,
  timestamptz,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb
) to authenticated, service_role;
