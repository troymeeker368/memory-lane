alter table public.billing_invoices
  add column if not exists bill_to_name_snapshot text,
  add column if not exists bill_to_address_line_1_snapshot text,
  add column if not exists bill_to_address_line_2_snapshot text,
  add column if not exists bill_to_address_line_3_snapshot text,
  add column if not exists bill_to_email_snapshot text,
  add column if not exists bill_to_phone_snapshot text,
  add column if not exists bill_to_message_snapshot text,
  add column if not exists payments_amount numeric(12,2) not null default 0,
  add column if not exists balance_due_amount numeric(12,2) not null default 0;

update public.billing_invoices
set
  payments_amount = coalesce(payments_amount, 0),
  balance_due_amount = coalesce(balance_due_amount, total_amount, 0)
where payments_amount is null
   or balance_due_amount is null;

with ranked_payors as (
  select distinct on (mc.member_id)
    mc.member_id,
    nullif(trim(mc.contact_name), '') as contact_name,
    nullif(trim(mc.street_address), '') as address_line_1,
    nullif(trim(concat_ws(', ', nullif(trim(mc.city), ''), nullif(trim(mc.state), ''), nullif(trim(mc.zip), ''))), '') as address_line_3,
    nullif(trim(mc.email), '') as email,
    coalesce(
      nullif(trim(mc.cellular_number), ''),
      nullif(trim(mc.work_number), ''),
      nullif(trim(mc.home_number), '')
    ) as phone
  from public.member_contacts mc
  where mc.is_payor = true
  order by mc.member_id, mc.updated_at desc nulls last, mc.created_at desc nulls last, mc.id desc
)
update public.billing_invoices bi
set
  bill_to_name_snapshot = coalesce(bi.bill_to_name_snapshot, rp.contact_name, 'No payor contact designated'),
  bill_to_address_line_1_snapshot = coalesce(bi.bill_to_address_line_1_snapshot, rp.address_line_1),
  bill_to_address_line_3_snapshot = coalesce(bi.bill_to_address_line_3_snapshot, rp.address_line_3),
  bill_to_email_snapshot = coalesce(bi.bill_to_email_snapshot, rp.email),
  bill_to_phone_snapshot = coalesce(bi.bill_to_phone_snapshot, rp.phone),
  bill_to_message_snapshot = coalesce(
    bi.bill_to_message_snapshot,
    case when rp.member_id is null then 'No payor contact designated' else null end
  )
from ranked_payors rp
where bi.member_id = rp.member_id
  and (
    bi.bill_to_name_snapshot is null
    or bi.bill_to_address_line_1_snapshot is null
    or bi.bill_to_address_line_3_snapshot is null
    or bi.bill_to_email_snapshot is null
    or bi.bill_to_phone_snapshot is null
    or bi.bill_to_message_snapshot is null
  );

update public.billing_invoices
set
  bill_to_name_snapshot = coalesce(bill_to_name_snapshot, 'No payor contact designated'),
  bill_to_message_snapshot = coalesce(bill_to_message_snapshot, 'No payor contact designated')
where bill_to_name_snapshot is null
   or bill_to_message_snapshot is null;

alter table public.billing_invoice_lines
  add column if not exists line_number integer,
  add column if not exists product_or_service text;

with numbered_lines as (
  select
    id,
    row_number() over (
      partition by invoice_id
      order by
        coalesce(service_date, service_period_start, service_period_end),
        created_at,
        id
    ) as line_number
  from public.billing_invoice_lines
)
update public.billing_invoice_lines bil
set line_number = nl.line_number
from numbered_lines nl
where bil.id = nl.id
  and bil.line_number is null;

update public.billing_invoice_lines
set product_or_service = case line_type
  when 'Transportation' then 'Transportation'
  when 'Ancillary' then 'Ancillary'
  when 'Adjustment' then 'Adjustment'
  when 'Credit' then 'Credit'
  when 'PriorBalance' then 'Prior Balance'
  else 'Member Fees'
end
where product_or_service is null;

alter table public.billing_invoice_lines
  alter column line_number set not null,
  alter column product_or_service set not null;

create index if not exists idx_billing_invoice_lines_invoice_line_number
  on public.billing_invoice_lines (invoice_id, line_number);

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
    coalesce(nullif(value ->> 'payments_amount', '')::numeric, 0),
    coalesce(nullif(value ->> 'balance_due_amount', '')::numeric, coalesce(nullif(value ->> 'total_amount', '')::numeric, 0)),
    nullif(value ->> 'bill_to_name_snapshot', ''),
    nullif(value ->> 'bill_to_address_line_1_snapshot', ''),
    nullif(value ->> 'bill_to_address_line_2_snapshot', ''),
    nullif(value ->> 'bill_to_address_line_3_snapshot', ''),
    nullif(value ->> 'bill_to_email_snapshot', ''),
    nullif(value ->> 'bill_to_phone_snapshot', ''),
    nullif(value ->> 'bill_to_message_snapshot', ''),
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
      where id = nullif(v_source_update ->> 'source_record_id', '')::uuid;
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
      where id = nullif(v_source_update ->> 'source_record_id', '')::uuid;
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
  v_source_update jsonb;
begin
  v_invoice_id := nullif(p_invoice ->> 'id', '')::uuid;
  if v_invoice_id is null then
    raise exception 'custom invoice id is required';
  end if;

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
    nullif(p_invoice ->> 'invoice_number', ''),
    nullif(p_invoice ->> 'invoice_month', '')::date,
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
      where id = nullif(v_source_update ->> 'source_record_id', '')::uuid;
      if not found then
        raise exception 'transportation log % was not found during custom invoice creation', v_source_update ->> 'source_record_id';
      end if;
    elsif v_source_update ->> 'source_table' = 'ancillary_charge_logs' then
      update public.ancillary_charge_logs
      set
        billing_status = 'Billed',
        billing_exclusion_reason = null,
        invoice_id = nullif(v_source_update ->> 'invoice_id', '')::uuid,
        updated_at = coalesce(nullif(v_source_update ->> 'updated_at', '')::timestamptz, now())
      where id = nullif(v_source_update ->> 'source_record_id', '')::uuid;
      if not found then
        raise exception 'ancillary charge log % was not found during custom invoice creation', v_source_update ->> 'source_record_id';
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
        raise exception 'billing adjustment % was not found during custom invoice creation', v_source_update ->> 'source_record_id';
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

grant execute on function public.rpc_generate_billing_batch(jsonb, jsonb, jsonb, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.rpc_create_custom_invoice(jsonb, jsonb, jsonb, jsonb) to authenticated, service_role;
