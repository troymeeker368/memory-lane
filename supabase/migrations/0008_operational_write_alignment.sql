alter table public.members
  add column if not exists discharge_reason text,
  add column if not exists discharge_disposition text,
  add column if not exists discharge_date date;

alter table public.ancillary_charge_logs
  add column if not exists reconciliation_status text not null default 'open' check (reconciliation_status in ('open', 'reconciled', 'void')),
  add column if not exists reconciled_by text,
  add column if not exists reconciled_at timestamptz,
  add column if not exists reconciliation_note text,
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists trg_ancillary_charge_logs_updated on public.ancillary_charge_logs;
create trigger trg_ancillary_charge_logs_updated before update on public.ancillary_charge_logs
for each row execute function public.set_updated_at();

drop policy if exists "members_update" on public.members;
create policy "members_update" on public.members
for update using (public.current_role() in ('admin', 'manager', 'director'))
with check (public.current_role() in ('admin', 'manager', 'director'));

drop policy if exists "ancillary_update" on public.ancillary_charge_logs;
create policy "ancillary_update" on public.ancillary_charge_logs
for update using (public.current_role() in ('admin', 'manager', 'director'))
with check (public.current_role() in ('admin', 'manager', 'director'));

drop policy if exists "health_blood_sugar_insert" on public.blood_sugar_logs;
create policy "health_blood_sugar_insert" on public.blood_sugar_logs
for insert with check (public.current_role() in ('admin', 'manager', 'director', 'nurse'));

drop policy if exists "health_blood_sugar_update" on public.blood_sugar_logs;
create policy "health_blood_sugar_update" on public.blood_sugar_logs
for update using (public.current_role() in ('admin', 'manager', 'director', 'nurse'))
with check (public.current_role() in ('admin', 'manager', 'director', 'nurse'));

drop policy if exists "health_blood_sugar_delete" on public.blood_sugar_logs;
create policy "health_blood_sugar_delete" on public.blood_sugar_logs
for delete using (public.current_role() in ('admin', 'manager', 'director'));
