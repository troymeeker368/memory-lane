alter table public.member_photo_uploads
  alter column member_id drop not null;

alter table public.toilet_logs
  add column if not exists member_supplied boolean not null default false;

alter table public.member_photo_uploads enable row level security;

drop policy if exists "daily_activity_update" on public.daily_activity_logs;
create policy "daily_activity_update" on public.daily_activity_logs
for update using (public.current_role() in ('admin', 'manager', 'director'))
with check (public.current_role() in ('admin', 'manager', 'director'));

drop policy if exists "daily_activity_delete" on public.daily_activity_logs;
create policy "daily_activity_delete" on public.daily_activity_logs
for delete using (public.current_role() in ('admin', 'manager', 'director'));

drop policy if exists "toilet_insert" on public.toilet_logs;
create policy "toilet_insert" on public.toilet_logs
for insert with check (staff_user_id = auth.uid() or public.current_role() in ('admin', 'manager', 'director'));

drop policy if exists "toilet_update" on public.toilet_logs;
create policy "toilet_update" on public.toilet_logs
for update using (public.current_role() in ('admin', 'manager', 'director'))
with check (public.current_role() in ('admin', 'manager', 'director'));

drop policy if exists "toilet_delete" on public.toilet_logs;
create policy "toilet_delete" on public.toilet_logs
for delete using (public.current_role() in ('admin', 'manager', 'director'));

drop policy if exists "shower_insert" on public.shower_logs;
create policy "shower_insert" on public.shower_logs
for insert with check (staff_user_id = auth.uid() or public.current_role() in ('admin', 'manager', 'director'));

drop policy if exists "shower_update" on public.shower_logs;
create policy "shower_update" on public.shower_logs
for update using (public.current_role() in ('admin', 'manager', 'director'))
with check (public.current_role() in ('admin', 'manager', 'director'));

drop policy if exists "shower_delete" on public.shower_logs;
create policy "shower_delete" on public.shower_logs
for delete using (public.current_role() in ('admin', 'manager', 'director'));

drop policy if exists "transport_insert" on public.transportation_logs;
create policy "transport_insert" on public.transportation_logs
for insert with check (staff_user_id = auth.uid() or public.current_role() in ('admin', 'manager', 'director'));

drop policy if exists "transport_update" on public.transportation_logs;
create policy "transport_update" on public.transportation_logs
for update using (public.current_role() in ('admin', 'manager', 'director'))
with check (public.current_role() in ('admin', 'manager', 'director'));

drop policy if exists "transport_delete" on public.transportation_logs;
create policy "transport_delete" on public.transportation_logs
for delete using (public.current_role() in ('admin', 'manager', 'director'));

drop policy if exists "photo_read" on public.member_photo_uploads;
create policy "photo_read" on public.member_photo_uploads
for select using (auth.uid() is not null);

drop policy if exists "photo_insert" on public.member_photo_uploads;
create policy "photo_insert" on public.member_photo_uploads
for insert with check (uploaded_by = auth.uid() or public.current_role() in ('admin', 'manager', 'director'));

drop policy if exists "photo_delete" on public.member_photo_uploads;
create policy "photo_delete" on public.member_photo_uploads
for delete using (public.current_role() in ('admin', 'manager', 'director'));

drop policy if exists "events_insert" on public.documentation_events;
create policy "events_insert" on public.documentation_events
for insert with check (staff_user_id = auth.uid() or public.current_role() in ('admin', 'manager', 'director'));
