with canonical_category as (
  insert into public.ancillary_charge_categories (name, price_cents)
  values ('Late Pickup', 2500)
  on conflict (name) do update
  set price_cents = excluded.price_cents
  returning id
),
resolved_canonical as (
  select id from canonical_category
  union all
  select id from public.ancillary_charge_categories where name = 'Late Pickup'
  limit 1
),
legacy_categories as (
  select id
  from public.ancillary_charge_categories
  where lower(name) in (
    'late pick-up (first 15 min)',
    'late pick-up (next 15 min)'
  )
)
update public.ancillary_charge_logs as acl
set category_id = (select id from resolved_canonical)
where acl.category_id in (select id from legacy_categories)
  and acl.category_id <> (select id from resolved_canonical);

delete from public.ancillary_charge_categories
where lower(name) in (
  'late pick-up (first 15 min)',
  'late pick-up (next 15 min)'
);
