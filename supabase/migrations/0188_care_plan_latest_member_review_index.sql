create index if not exists idx_care_plans_member_review_updated_desc
  on public.care_plans (member_id, review_date desc, updated_at desc);
