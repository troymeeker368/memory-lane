create index if not exists idx_audit_logs_action_created_at_desc
  on public.audit_logs (action, created_at desc);

create index if not exists idx_blood_sugar_logs_checked_at_desc
  on public.blood_sugar_logs (checked_at desc);
