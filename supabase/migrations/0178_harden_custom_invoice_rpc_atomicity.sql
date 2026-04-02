create or replace function public.rpc_create_custom_invoice(
  p_invoice jsonb,
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
  v_invoice_id uuid;
  v_invoice_month date;
  v_invoice_number text;
  v_source_update jsonb;
begin
  v_invoice_id := nullif(p_invoice ->> 'id', '')::uuid;
  if v_invoice_id is null then
    raise exception 'custom invoice id is required';
  end if;

  v_invoice_month := date_trunc(
    'month',
    coalesce(
      nullif(p_invoice ->> 'invoice_month', '')::date,
      nullif(p_invoice ->> 'base_period_start', '')::date
    )
  )::date;
  if v_invoice_month is null then
    raise exception 'custom invoice month is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('billing_custom_invoice_number'),
    hashtext(v_invoice_month::text)
  );

  select format(
    'CINV-%s-%s',
    to_char(v_invoice_month, 'YYYYMM'),
    lpad(
      (
        coalesce(
          max(
            case
              when invoice_number ~ ('^CINV-' || to_char(v_invoice_month, 'YYYYMM') || '-[0-9]{4}$')
                then right(invoice_number, 4)::integer
              else null
            end
          ),
          0
        ) + 1
      )::text,
      4,
      '0'
    )
  )
  into v_invoice_number
  from public.billing_invoices
  where invoice_source = 'Custom'
    and invoice_month = v_invoice_month;

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
    payments_amount,
    balance_due_amount,
    bill_to_name_snapshot,
    bill_to_address_line_1_snapshot,
    bill_to_address_line_2_snapshot,
    bill_to_address_line_3_snapshot,
    bill_to_email_snapshot,
    bill_to_phone_snapshot,
    bill_to_message_snapshot,
    notes,
    created_by_user_id,
    created_by_name,
    created_at,
    updated_at
  )
  values (
    v_invoice_id,
    nullif(p_invoice ->> 'billing_batch_id', '')::uuid,
    nullif(p_invoice ->> 'member_id', '')::uuid,
    nullif(p_invoice ->> 'payor_id', ''),
    v_invoice_number,
    v_invoice_month,
    coalesce(nullif(p_invoice ->> 'invoice_source', ''), 'Custom'),
    coalesce(nullif(p_invoice ->> 'invoice_status', ''), 'Draft'),
    coalesce(nullif(p_invoice ->> 'export_status', ''), 'NotExported'),
    nullif(p_invoice ->> 'billing_mode_snapshot', ''),
    nullif(p_invoice ->> 'monthly_billing_basis_snapshot', ''),
    nullif(p_invoice ->> 'transportation_billing_status_snapshot', ''),
    nullif(p_invoice ->> 'billing_method_snapshot', ''),
    nullif(p_invoice ->> 'base_period_start', '')::date,
    nullif(p_invoice ->> 'base_period_end', '')::date,
    nullif(p_invoice ->> 'variable_charge_period_start', '')::date,
    nullif(p_invoice ->> 'variable_charge_period_end', '')::date,
    nullif(p_invoice ->> 'invoice_date', '')::date,
    nullif(p_invoice ->> 'due_date', '')::date,
    coalesce(nullif(p_invoice ->> 'base_program_billed_days', '')::numeric, 0),
    coalesce(nullif(p_invoice ->> 'member_daily_rate_snapshot', '')::numeric, 0),
    coalesce(nullif(p_invoice ->> 'base_program_amount', '')::numeric, 0),
    coalesce(nullif(p_invoice ->> 'transportation_amount', '')::numeric, 0),
    coalesce(nullif(p_invoice ->> 'ancillary_amount', '')::numeric, 0),
    coalesce(nullif(p_invoice ->> 'adjustment_amount', '')::numeric, 0),
    coalesce(nullif(p_invoice ->> 'total_amount', '')::numeric, 0),
    coalesce(nullif(p_invoice ->> 'payments_amount', '')::numeric, 0),
    coalesce(nullif(p_invoice ->> 'balance_due_amount', '')::numeric, coalesce(nullif(p_invoice ->> 'total_amount', '')::numeric, 0)),
    nullif(p_invoice ->> 'bill_to_name_snapshot', ''),
    nullif(p_invoice ->> 'bill_to_address_line_1_snapshot', ''),
    nullif(p_invoice ->> 'bill_to_address_line_2_snapshot', ''),
    nullif(p_invoice ->> 'bill_to_address_line_3_snapshot', ''),
    nullif(p_invoice ->> 'bill_to_email_snapshot', ''),
    nullif(p_invoice ->> 'bill_to_phone_snapshot', ''),
    nullif(p_invoice ->> 'bill_to_message_snapshot', ''),
    nullif(p_invoice ->> 'notes', ''),
    nullif(p_invoice ->> 'created_by_user_id', '')::uuid,
    nullif(p_invoice ->> 'created_by_name', ''),
    coalesce(nullif(p_invoice ->> 'created_at', '')::timestamptz, now()),
    coalesce(nullif(p_invoice ->> 'updated_at', '')::timestamptz, now())
  );

  insert into public.billing_invoice_lines (
    id,
    invoice_id,
    member_id,
    payor_id,
    line_number,
    product_or_service,
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
    coalesce(nullif(value ->> 'line_number', '')::integer, 1),
    coalesce(nullif(value ->> 'product_or_service', ''), 'Member Fees'),
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
      where id = nullif(v_source_update ->> 'source_record_id', '')::uuid
        and coalesce(billing_status, 'Unbilled') = 'Unbilled'
        and invoice_id is null;
      if not found then
        raise exception 'transportation log % is no longer unbilled during custom invoice creation', v_source_update ->> 'source_record_id';
      end if;
    elsif v_source_update ->> 'source_table' = 'ancillary_charge_logs' then
      update public.ancillary_charge_logs
      set
        billing_status = 'Billed',
        billing_exclusion_reason = null,
        invoice_id = nullif(v_source_update ->> 'invoice_id', '')::uuid,
        updated_at = coalesce(nullif(v_source_update ->> 'updated_at', '')::timestamptz, now())
      where id = nullif(v_source_update ->> 'source_record_id', '')::uuid
        and coalesce(billing_status, 'Unbilled') = 'Unbilled'
        and invoice_id is null;
      if not found then
        raise exception 'ancillary charge log % is no longer unbilled during custom invoice creation', v_source_update ->> 'source_record_id';
      end if;
    elsif v_source_update ->> 'source_table' = 'billing_adjustments' then
      update public.billing_adjustments
      set
        billing_status = 'Billed',
        exclusion_reason = null,
        invoice_id = nullif(v_source_update ->> 'invoice_id', '')::uuid,
        updated_at = coalesce(nullif(v_source_update ->> 'updated_at', '')::timestamptz, now())
      where id = nullif(v_source_update ->> 'source_record_id', '')::uuid
        and coalesce(billing_status, 'Unbilled') = 'Unbilled'
        and invoice_id is null;
      if not found then
        raise exception 'billing adjustment % is no longer unbilled during custom invoice creation', v_source_update ->> 'source_record_id';
      end if;
    else
      raise exception 'unsupported custom invoice source table %', coalesce(v_source_update ->> 'source_table', 'null');
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

  return v_invoice_id;
end;
$$;

grant execute on function public.rpc_create_custom_invoice(jsonb, jsonb, jsonb, jsonb) to authenticated, service_role;
