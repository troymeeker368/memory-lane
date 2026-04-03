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
  v_member_id uuid;
  v_payor_id text;
  v_invoice_month date;
  v_invoice_number text;
  v_source_update jsonb;
  v_line_request jsonb;
  v_source_table text;
  v_source_record_id uuid;
  v_line_id uuid;
  v_line_number integer;
  v_line_created_at timestamptz;
  v_line_updated_at timestamptz;
  v_line_service_date date;
  v_line_service_period_start date;
  v_line_service_period_end date;
  v_line_type text;
  v_line_description text;
  v_line_quantity numeric(10,2);
  v_line_unit_rate numeric(10,2);
  v_line_amount numeric(12,2);
  v_line_product_or_service text;
begin
  v_invoice_id := nullif(p_invoice ->> 'id', '')::uuid;
  if v_invoice_id is null then
    raise exception 'custom invoice id is required';
  end if;

  v_member_id := nullif(p_invoice ->> 'member_id', '')::uuid;
  if v_member_id is null then
    raise exception 'custom invoice member is required';
  end if;

  v_payor_id := nullif(p_invoice ->> 'payor_id', '');

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
    v_member_id,
    v_payor_id,
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
    v_invoice_id,
    v_member_id,
    v_payor_id,
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
  from jsonb_array_elements(coalesce(p_invoice_lines, '[]'::jsonb)) value
  where coalesce(nullif(value ->> 'source_table', ''), '') not in ('transportation_logs', 'ancillary_charge_logs', 'billing_adjustments');

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
    v_member_id,
    nullif(value ->> 'coverage_type', ''),
    nullif(value ->> 'coverage_start_date', '')::date,
    nullif(value ->> 'coverage_end_date', '')::date,
    v_invoice_id,
    nullif(value ->> 'source_invoice_line_id', '')::uuid,
    nullif(value ->> 'source_table', ''),
    nullif(value ->> 'source_record_id', ''),
    coalesce(nullif(value ->> 'created_at', '')::timestamptz, now())
  from jsonb_array_elements(coalesce(p_coverages, '[]'::jsonb)) value
  where coalesce(nullif(value ->> 'source_table', ''), '') not in ('transportation_logs', 'ancillary_charge_logs', 'billing_adjustments');

  for v_source_update in
    select value
    from jsonb_array_elements(coalesce(p_source_updates, '[]'::jsonb)) value
  loop
    v_source_table := coalesce(v_source_update ->> 'source_table', '');
    v_source_record_id := nullif(v_source_update ->> 'source_record_id', '')::uuid;

    if v_source_record_id is null then
      raise exception 'custom invoice source record id is required for source table %', coalesce(v_source_table, 'null');
    end if;

    select value
    into v_line_request
    from jsonb_array_elements(coalesce(p_invoice_lines, '[]'::jsonb)) value
    where coalesce(value ->> 'source_table', '') = v_source_table
      and nullif(value ->> 'source_record_id', '')::uuid = v_source_record_id
    order by coalesce(nullif(value ->> 'line_number', '')::integer, 2147483647)
    limit 1;

    if v_line_request is null then
      raise exception 'custom invoice line payload missing for source table % and record %', v_source_table, v_source_record_id;
    end if;

    v_line_id := coalesce(nullif(v_line_request ->> 'id', '')::uuid, gen_random_uuid());
    v_line_number := coalesce(nullif(v_line_request ->> 'line_number', '')::integer, 1);
    v_line_created_at := coalesce(nullif(v_line_request ->> 'created_at', '')::timestamptz, now());
    v_line_updated_at := coalesce(
      nullif(v_source_update ->> 'updated_at', '')::timestamptz,
      nullif(v_line_request ->> 'updated_at', '')::timestamptz,
      now()
    );

    if v_source_table = 'transportation_logs' then
      select
        tl.service_date,
        coalesce(tl.quantity, 1),
        coalesce(tl.unit_rate, 0),
        case
          when coalesce(tl.total_amount, 0) > 0 then tl.total_amount
          else round(coalesce(tl.quantity, 1) * coalesce(tl.unit_rate, 0), 2)
        end,
        format('Transportation (%s)', coalesce(tl.transport_type, 'Trip'))
      into
        v_line_service_date,
        v_line_quantity,
        v_line_unit_rate,
        v_line_amount,
        v_line_description
      from public.transportation_logs tl
      where tl.id = v_source_record_id
        and tl.member_id = v_member_id
        and coalesce(tl.billing_status, 'Unbilled') = 'Unbilled'
        and tl.invoice_id is null
        and tl.billable is not false
      for update of tl;

      if not found then
        raise exception 'transportation log % is no longer unbilled during custom invoice creation', v_source_record_id;
      end if;

      if v_line_service_date is null then
        raise exception 'transportation log % is missing service_date during custom invoice creation', v_source_record_id;
      end if;

      v_line_type := 'Transportation';
      v_line_service_period_start := v_line_service_date;
      v_line_service_period_end := v_line_service_date;
      v_line_product_or_service := 'Transportation';

      update public.transportation_logs
      set
        billing_status = 'Billed',
        billing_exclusion_reason = null,
        invoice_id = v_invoice_id,
        updated_at = v_line_updated_at
      where id = v_source_record_id;
    elsif v_source_table = 'ancillary_charge_logs' then
      select
        acl.service_date,
        coalesce(acl.quantity, 1),
        case
          when coalesce(acl.unit_rate, 0) > 0 then acl.unit_rate
          else round(coalesce(acc.price_cents, 0)::numeric / 100, 2)
        end,
        case
          when coalesce(acl.amount, 0) > 0 then acl.amount
          else round(
            coalesce(acl.quantity, 1) * (
              case
                when coalesce(acl.unit_rate, 0) > 0 then acl.unit_rate
                else round(coalesce(acc.price_cents, 0)::numeric / 100, 2)
              end
            ),
            2
          )
        end,
        coalesce(nullif(acc.name, ''), 'Ancillary Charge')
      into
        v_line_service_date,
        v_line_quantity,
        v_line_unit_rate,
        v_line_amount,
        v_line_description
      from public.ancillary_charge_logs acl
      left join public.ancillary_charge_categories acc on acc.id = acl.category_id
      where acl.id = v_source_record_id
        and acl.member_id = v_member_id
        and coalesce(acl.billing_status, 'Unbilled') = 'Unbilled'
        and acl.invoice_id is null
      for update of acl;

      if not found then
        raise exception 'ancillary charge log % is no longer unbilled during custom invoice creation', v_source_record_id;
      end if;

      if v_line_service_date is null then
        raise exception 'ancillary charge log % is missing service_date during custom invoice creation', v_source_record_id;
      end if;

      v_line_type := 'Ancillary';
      v_line_service_period_start := v_line_service_date;
      v_line_service_period_end := v_line_service_date;
      v_line_product_or_service := 'Ancillary';

      update public.ancillary_charge_logs
      set
        billing_status = 'Billed',
        billing_exclusion_reason = null,
        invoice_id = v_invoice_id,
        updated_at = v_line_updated_at
      where id = v_source_record_id;
    elsif v_source_table = 'billing_adjustments' then
      select
        ba.adjustment_date,
        coalesce(ba.quantity, 1),
        coalesce(ba.unit_rate, 0),
        coalesce(ba.amount, 0),
        coalesce(nullif(ba.description, ''), 'Adjustment'),
        case
          when coalesce(ba.amount, 0) < 0 then 'Credit'
          else 'Adjustment'
        end
      into
        v_line_service_date,
        v_line_quantity,
        v_line_unit_rate,
        v_line_amount,
        v_line_description,
        v_line_type
      from public.billing_adjustments ba
      where ba.id = v_source_record_id
        and ba.member_id = v_member_id
        and coalesce(ba.billing_status, 'Unbilled') = 'Unbilled'
        and ba.invoice_id is null
      for update of ba;

      if not found then
        raise exception 'billing adjustment % is no longer unbilled during custom invoice creation', v_source_record_id;
      end if;

      if v_line_service_date is null then
        raise exception 'billing adjustment % is missing adjustment_date during custom invoice creation', v_source_record_id;
      end if;

      v_line_service_period_start := v_line_service_date;
      v_line_service_period_end := v_line_service_date;
      v_line_product_or_service := case when v_line_type = 'Credit' then 'Credit' else 'Adjustment' end;

      update public.billing_adjustments
      set
        billing_status = 'Billed',
        exclusion_reason = null,
        invoice_id = v_invoice_id,
        updated_at = v_line_updated_at
      where id = v_source_record_id;
    else
      raise exception 'unsupported custom invoice source table %', coalesce(v_source_table, 'null');
    end if;

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
    values (
      v_line_id,
      v_invoice_id,
      v_member_id,
      v_payor_id,
      v_line_number,
      v_line_product_or_service,
      v_line_service_date,
      v_line_service_period_start,
      v_line_service_period_end,
      v_line_type,
      v_line_description,
      v_line_quantity,
      v_line_unit_rate,
      v_line_amount,
      v_source_table,
      v_source_record_id::text,
      'Billed',
      v_line_created_at,
      v_line_updated_at
    );

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
    values (
      v_member_id,
      case
        when v_line_type = 'Transportation' then 'Transportation'
        when v_line_type = 'Ancillary' then 'Ancillary'
        when v_line_type = 'BaseProgram' then 'BaseProgram'
        else 'Adjustment'
      end,
      v_line_service_period_start,
      v_line_service_period_end,
      v_invoice_id,
      v_line_id,
      v_source_table,
      v_source_record_id::text,
      v_line_created_at
    );
  end loop;

  update public.billing_invoices bi
  set
    base_program_amount = totals.base_program_amount,
    transportation_amount = totals.transportation_amount,
    ancillary_amount = totals.ancillary_amount,
    adjustment_amount = totals.adjustment_amount,
    total_amount = totals.total_amount,
    balance_due_amount = totals.total_amount - coalesce(bi.payments_amount, 0),
    updated_at = now()
  from (
    select
      coalesce(sum(case when line_type = 'BaseProgram' then amount else 0 end), 0)::numeric(12,2) as base_program_amount,
      coalesce(sum(case when line_type = 'Transportation' then amount else 0 end), 0)::numeric(12,2) as transportation_amount,
      coalesce(sum(case when line_type = 'Ancillary' then amount else 0 end), 0)::numeric(12,2) as ancillary_amount,
      coalesce(sum(case when line_type in ('Adjustment', 'Credit', 'PriorBalance') then amount else 0 end), 0)::numeric(12,2) as adjustment_amount,
      coalesce(sum(amount), 0)::numeric(12,2) as total_amount
    from public.billing_invoice_lines
    where invoice_id = v_invoice_id
  ) totals
  where bi.id = v_invoice_id;

  return v_invoice_id;
end;
$$;

grant execute on function public.rpc_create_custom_invoice(jsonb, jsonb, jsonb, jsonb) to authenticated, service_role;
