-- Ensure manual-add transportation adjustments always carry an explicit transport mode.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'transportation_manifest_adjustments_add_requires_transport_type'
      and conrelid = 'public.transportation_manifest_adjustments'::regclass
  ) then
    alter table public.transportation_manifest_adjustments
      add constraint transportation_manifest_adjustments_add_requires_transport_type
      check (
        adjustment_type <> 'add'
        or transport_type is not null
      ) not valid;
  end if;
end
$$;
