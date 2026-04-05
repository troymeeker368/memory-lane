create index if not exists idx_pof_medications_mhp_mar_sync
  on public.pof_medications (member_id, updated_at desc)
  where active = true
    and given_at_center = true
    and prn = false
    and source_medication_id like 'mhp-%';
