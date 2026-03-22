alter table public.care_plans
  add column if not exists post_sign_readiness_status text not null default 'not_started',
  add column if not exists post_sign_readiness_reason text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.care_plans'::regclass
      and conname = 'care_plans_post_sign_readiness_status_check'
  ) then
    alter table public.care_plans
      add constraint care_plans_post_sign_readiness_status_check
      check (
        post_sign_readiness_status in (
          'not_started',
          'signed_pending_snapshot',
          'signed_pending_caregiver_dispatch',
          'ready'
        )
      );
  end if;
end;
$$;

create index if not exists idx_care_plans_post_sign_readiness_status_updated
  on public.care_plans(post_sign_readiness_status, updated_at desc);
