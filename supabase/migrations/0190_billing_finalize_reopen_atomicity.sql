create or replace function public.finalize_billing_invoice_set(
  p_invoice_ids uuid[],
  p_finalized_by text,
  p_now timestamptz default now(),
  p_today date default current_date
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_invoice_ids uuid[];
  v_requested_count integer;
  v_locked_count integer;
  v_missing_invoice_id uuid;
  v_invalid_invoice_id uuid;
  v_invalid_invoice_status text;
  v_now timestamptz := coalesce(p_now, now());
  v_today date := coalesce(p_today, current_date);
begin
  if nullif(trim(coalesce(p_finalized_by, '')), '') is null then
    raise exception 'finalized_by is required';
  end if;

  select coalesce(array_agg(distinct invoice_id), array[]::uuid[])
  into v_invoice_ids
  from unnest(coalesce(p_invoice_ids, array[]::uuid[])) as requested(invoice_id)
  where requested.invoice_id is not null;

  v_requested_count := coalesce(array_length(v_invoice_ids, 1), 0);
  if v_requested_count = 0 then
    raise exception 'at least one billing invoice id is required';
  end if;

  with locked as (
    select bi.id
    from public.billing_invoices bi
    where bi.id = any(v_invoice_ids)
    for update
  )
  select count(*)
  into v_locked_count
  from locked;

  if v_locked_count <> v_requested_count then
    select requested.invoice_id
    into v_missing_invoice_id
    from unnest(v_invoice_ids) as requested(invoice_id)
    where not exists (
      select 1
      from public.billing_invoices bi
      where bi.id = requested.invoice_id
    )
    limit 1;

    raise exception 'Billing invoice % was not found.', coalesce(v_missing_invoice_id::text, 'unknown');
  end if;

  select bi.id, bi.invoice_status
  into v_invalid_invoice_id, v_invalid_invoice_status
  from public.billing_invoices bi
  where bi.id = any(v_invoice_ids)
    and bi.invoice_status not in ('Draft', 'Finalized')
  order by bi.created_at asc, bi.id asc
  limit 1;

  if v_invalid_invoice_id is not null then
    raise exception
      'Billing invoice % cannot be finalized from status %.',
      v_invalid_invoice_id,
      coalesce(v_invalid_invoice_status, 'null');
  end if;

  update public.billing_invoices bi
  set
    invoice_status = 'Finalized',
    finalized_by = p_finalized_by,
    finalized_at = v_now,
    invoice_date = coalesce(bi.invoice_date, v_today),
    due_date = coalesce(bi.due_date, coalesce(bi.invoice_date, v_today) + 30),
    updated_at = v_now
  where bi.id = any(v_invoice_ids)
    and bi.invoice_status = 'Draft';

  return v_requested_count;
end;
$$;

create or replace function public.rpc_finalize_billing_invoices(
  p_invoice_ids uuid[],
  p_finalized_by text,
  p_now timestamptz default now(),
  p_today date default current_date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.finalize_billing_invoice_set(
    p_invoice_ids => p_invoice_ids,
    p_finalized_by => p_finalized_by,
    p_now => p_now,
    p_today => p_today
  );
end;
$$;

create or replace function public.rpc_finalize_billing_batch(
  p_billing_batch_id uuid,
  p_finalized_by text,
  p_now timestamptz default now(),
  p_today date default current_date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.billing_batches%rowtype;
  v_invoice_ids uuid[] := array[]::uuid[];
  v_now timestamptz := coalesce(p_now, now());
  v_today date := coalesce(p_today, current_date);
begin
  if p_billing_batch_id is null then
    raise exception 'billing batch id is required';
  end if;
  if nullif(trim(coalesce(p_finalized_by, '')), '') is null then
    raise exception 'finalized_by is required';
  end if;

  select *
  into v_batch
  from public.billing_batches
  where id = p_billing_batch_id
  for update;

  if not found then
    raise exception 'Billing batch % was not found.', p_billing_batch_id;
  end if;

  if coalesce(v_batch.batch_status, '') = 'Finalized' then
    return v_batch.id;
  end if;

  if coalesce(v_batch.batch_status, '') not in ('Draft', 'Reviewed') then
    raise exception
      'Billing batch % cannot be finalized from status %.',
      p_billing_batch_id,
      coalesce(v_batch.batch_status, 'null');
  end if;

  select coalesce(array_agg(bi.id order by bi.created_at asc, bi.id asc), array[]::uuid[])
  into v_invoice_ids
  from public.billing_invoices bi
  where bi.billing_batch_id = p_billing_batch_id;

  if coalesce(array_length(v_invoice_ids, 1), 0) > 0 then
    perform public.finalize_billing_invoice_set(
      p_invoice_ids => v_invoice_ids,
      p_finalized_by => p_finalized_by,
      p_now => v_now,
      p_today => v_today
    );
  end if;

  update public.billing_batches
  set
    batch_status = 'Finalized',
    finalized_by = p_finalized_by,
    finalized_at = v_now,
    completion_date = v_today,
    next_due_date = (date_trunc('month', v_batch.billing_month)::date + interval '1 month')::date,
    updated_at = v_now
  where id = p_billing_batch_id;

  return p_billing_batch_id;
end;
$$;

create or replace function public.rpc_reopen_billing_batch(
  p_billing_batch_id uuid,
  p_reopened_by text,
  p_now timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.billing_batches%rowtype;
  v_invoice_ids uuid[] := array[]::uuid[];
  v_now timestamptz := coalesce(p_now, now());
begin
  if p_billing_batch_id is null then
    raise exception 'billing batch id is required';
  end if;
  if nullif(trim(coalesce(p_reopened_by, '')), '') is null then
    raise exception 'reopened_by is required';
  end if;

  select *
  into v_batch
  from public.billing_batches
  where id = p_billing_batch_id
  for update;

  if not found then
    raise exception 'Billing batch % was not found.', p_billing_batch_id;
  end if;

  if coalesce(v_batch.batch_status, '') = 'Reviewed' then
    return v_batch.id;
  end if;

  if coalesce(v_batch.batch_status, '') not in ('Finalized', 'Exported', 'Closed') then
    raise exception
      'Billing batch % cannot be reopened from status %.',
      p_billing_batch_id,
      coalesce(v_batch.batch_status, 'null');
  end if;

  with locked_invoices as (
    select bi.id
    from public.billing_invoices bi
    where bi.billing_batch_id = p_billing_batch_id
    for update
  )
  select coalesce(array_agg(locked_invoices.id order by locked_invoices.id), array[]::uuid[])
  into v_invoice_ids
  from locked_invoices;

  if coalesce(array_length(v_invoice_ids, 1), 0) > 0 then
    update public.transportation_logs
    set
      billing_status = 'Unbilled',
      invoice_id = null,
      updated_at = v_now
    where invoice_id = any(v_invoice_ids);

    update public.ancillary_charge_logs
    set
      billing_status = 'Unbilled',
      invoice_id = null,
      updated_at = v_now
    where invoice_id = any(v_invoice_ids);

    update public.billing_adjustments
    set
      billing_status = 'Unbilled',
      invoice_id = null,
      updated_at = v_now
    where invoice_id = any(v_invoice_ids);

    delete from public.billing_coverages
    where source_invoice_id = any(v_invoice_ids);

    update public.billing_invoice_lines
    set
      billing_status = 'Unbilled',
      updated_at = v_now
    where invoice_id = any(v_invoice_ids);

    update public.billing_invoices
    set
      invoice_status = 'Draft',
      export_status = 'NotExported',
      finalized_by = null,
      finalized_at = null,
      updated_at = v_now
    where id = any(v_invoice_ids);
  end if;

  update public.billing_batches
  set
    batch_status = 'Reviewed',
    reopened_by = p_reopened_by,
    reopened_at = v_now,
    finalized_by = null,
    finalized_at = null,
    completion_date = null,
    updated_at = v_now
  where id = p_billing_batch_id;

  return p_billing_batch_id;
end;
$$;

grant execute on function public.rpc_finalize_billing_invoices(uuid[], text, timestamptz, date) to authenticated, service_role;
grant execute on function public.rpc_finalize_billing_batch(uuid, text, timestamptz, date) to authenticated, service_role;
grant execute on function public.rpc_reopen_billing_batch(uuid, text, timestamptz) to authenticated, service_role;
