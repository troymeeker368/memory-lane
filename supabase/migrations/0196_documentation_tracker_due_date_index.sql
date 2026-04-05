create index if not exists idx_documentation_tracker_care_plan_due_open
  on public.documentation_tracker (next_care_plan_due asc, member_id)
  where care_plan_done = false;
