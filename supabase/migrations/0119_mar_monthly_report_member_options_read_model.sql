create extension if not exists pg_trgm;

create or replace function public.rpc_list_mar_monthly_report_member_options()
returns table (
  member_id uuid,
  member_name text,
  member_dob date,
  member_identifier text,
  member_status text,
  active_for_workflow boolean,
  eligible_for_report boolean
)
language sql
stable
set search_path = public
as $$
  with eligible_members as (
    select distinct m.id as member_id
    from public.members m
    where exists (
        select 1
        from public.pof_medications pm
        where pm.member_id = m.id
          and pm.member_id is not null
          and pm.given_at_center = true
      )
      or exists (
        select 1
        from public.mar_administrations ma
        where ma.member_id = m.id
          and ma.member_id is not null
      )
      or exists (
        select 1
        from public.medication_orders mo
        where mo.member_id = m.id
          and mo.member_id is not null
          and mo.order_type = 'prn'
      )
      or exists (
        select 1
        from public.med_administration_logs mal
        where mal.member_id = m.id
          and mal.member_id is not null
          and mal.admin_type = 'prn'
      )
  )
  select
    m.id as member_id,
    m.display_name as member_name,
    m.dob as member_dob,
    nullif(trim(m.qr_code), '') as member_identifier,
    nullif(trim(m.status), '') as member_status,
    (coalesce(m.status, '') = 'active') as active_for_workflow,
    (em.member_id is not null) as eligible_for_report
  from public.members m
  left join eligible_members em on em.member_id = m.id
  where coalesce(m.status, '') = 'active'
     or em.member_id is not null
  order by m.display_name asc, m.id asc;
$$;

grant execute on function public.rpc_list_mar_monthly_report_member_options() to authenticated, service_role;

create index if not exists idx_pof_medications_reportable_member_center_given
  on public.pof_medications (member_id)
  where given_at_center = true and member_id is not null;

create index if not exists idx_mar_administrations_reportable_member
  on public.mar_administrations (member_id)
  where member_id is not null;

create index if not exists idx_medication_orders_reportable_prn_member
  on public.medication_orders (member_id)
  where order_type = 'prn' and member_id is not null;

create index if not exists idx_med_administration_logs_reportable_prn_member
  on public.med_administration_logs (member_id)
  where admin_type = 'prn' and member_id is not null;

create or replace function public.rpc_list_mar_member_options()
returns table (
  member_id uuid,
  member_name text,
  member_dob date,
  member_identifier text,
  member_status text,
  active_for_workflow boolean,
  eligible_for_report boolean
)
language sql
stable
set search_path = public
as $$
  select * from public.rpc_list_mar_monthly_report_member_options();
$$;

grant execute on function public.rpc_list_mar_member_options() to authenticated, service_role;
