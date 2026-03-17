drop policy if exists "member_contacts_select" on public.member_contacts;
drop policy if exists "member_contacts_insert" on public.member_contacts;
drop policy if exists "member_contacts_update" on public.member_contacts;
drop policy if exists "member_contacts_delete" on public.member_contacts;
drop policy if exists "member_contacts_service_role_all" on public.member_contacts;

create policy "member_contacts_select"
on public.member_contacts
for select
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

create policy "member_contacts_insert"
on public.member_contacts
for insert
to authenticated
with check (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

create policy "member_contacts_update"
on public.member_contacts
for update
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'))
with check (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

create policy "member_contacts_delete"
on public.member_contacts
for delete
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator'));

create policy "member_contacts_service_role_all"
on public.member_contacts
for all
to service_role
using (true)
with check (true);

drop policy if exists "payors_select" on public.payors;
drop policy if exists "payors_insert" on public.payors;
drop policy if exists "payors_update" on public.payors;
drop policy if exists "payors_delete" on public.payors;
drop policy if exists "payors_service_role_all" on public.payors;

create policy "payors_select"
on public.payors
for select
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

create policy "payors_insert"
on public.payors
for insert
to authenticated
with check (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

create policy "payors_update"
on public.payors
for update
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'coordinator'))
with check (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

create policy "payors_delete"
on public.payors
for delete
to authenticated
using (public.current_role() in ('admin', 'manager', 'director'));

create policy "payors_service_role_all"
on public.payors
for all
to service_role
using (true)
with check (true);

drop policy if exists "member_billing_settings_select" on public.member_billing_settings;
drop policy if exists "member_billing_settings_insert" on public.member_billing_settings;
drop policy if exists "member_billing_settings_update" on public.member_billing_settings;
drop policy if exists "member_billing_settings_delete" on public.member_billing_settings;
drop policy if exists "member_billing_settings_service_role_all" on public.member_billing_settings;

create policy "member_billing_settings_select"
on public.member_billing_settings
for select
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

create policy "member_billing_settings_insert"
on public.member_billing_settings
for insert
to authenticated
with check (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

create policy "member_billing_settings_update"
on public.member_billing_settings
for update
to authenticated
using (public.current_role() in ('admin', 'manager', 'director', 'coordinator'))
with check (public.current_role() in ('admin', 'manager', 'director', 'coordinator'));

create policy "member_billing_settings_delete"
on public.member_billing_settings
for delete
to authenticated
using (public.current_role() in ('admin', 'manager', 'director'));

create policy "member_billing_settings_service_role_all"
on public.member_billing_settings
for all
to service_role
using (true)
with check (true);

create or replace function public.member_contacts_auto_seed_payor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(btrim(coalesce(new.category, ''))) in ('responsible party', 'guarantor')
    and coalesce(new.is_payor, false) = false
    and not exists (
      select 1
      from public.member_contacts existing
      where existing.member_id = new.member_id
        and existing.is_payor = true
        and existing.id <> new.id
    ) then
    update public.member_contacts
    set
      is_payor = true,
      updated_at = coalesce(new.updated_at, now())
    where id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_member_contacts_auto_seed_payor on public.member_contacts;

create trigger trg_member_contacts_auto_seed_payor
after insert on public.member_contacts
for each row
execute function public.member_contacts_auto_seed_payor();
