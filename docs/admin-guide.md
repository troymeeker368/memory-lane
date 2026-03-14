# Admin Guide

## Scope

This guide documents production admin operations that must remain Supabase-canonical.

## Manage Staff Roles

1. Create user in Supabase Auth (`auth.users`).
2. Insert/update matching row in `public.profiles` with the same `id`.
3. Set `role` to a canonical role key:
   - `program-assistant`
   - `coordinator`
   - `nurse`
   - `sales`
   - `manager`
   - `director`
   - `admin`
4. Set `active = true` to permit access.
5. Add `public.user_permissions` overrides only when custom overrides are intentionally required.
6. Keep staff auth lifecycle fields aligned on `public.profiles`:
   - `auth_user_id` (maps to `auth.users.id`)
   - `status` (`invited` | `active` | `disabled`)
   - `invited_at`, `password_set_at`, `last_sign_in_at`, `disabled_at`
   - `is_active`

Example:

```sql
update public.profiles
set role = 'manager', active = true
where email = 'manager@example.com';
```

## Role/Permission Enforcement Expectations

- Role normalization and permission resolution are canonical in `lib/permissions.ts`.
- Route/action access checks are canonical in `lib/auth.ts`.
- Sensitive actions must enforce access in code, not only in UI affordances.
- Do not introduce alternate permission maps outside canonical auth/permission services.

## Manage Lookup Data

- Use `public.lookup_lists` for dropdown and controlled-value lists.
- Set `active = false` to retire values without deleting historical records.

Example:

```sql
insert into public.lookup_lists (list_name, value, sort_order)
values ('lead_source', 'Hospital Partner', 6)
on conflict (list_name, value) do nothing;
```

## Manage Ancillary Categories

```sql
insert into public.ancillary_charge_categories (name, price_cents)
values ('Special Transport', 3000)
on conflict (name) do update set price_cents = excluded.price_cents;
```

## Public E-Sign Operational Dependencies

POF e-sign relies on:
- `public.pof_requests`
- `public.pof_signatures`
- `public.document_events`
- `public.member_files` linkage fields added by migration
- storage bucket `member-documents`
- configured outbound sender email and `RESEND_API_KEY`

Intake assessment e-sign relies on:
- `public.intake_assessment_signatures`
- signed-state fields on `public.intake_assessments`

Do not bypass canonical e-sign services when creating, signing, or voiding requests.

## Migration Discipline

- Apply forward-only migrations in numeric order.
- Do not manually patch production tables without corresponding migration files.
- Resolve schema drift by migrations plus service alignment, never fallback logic.

## Audit And Retention

- `public.audit_logs` stores privileged action traceability.
- `public.document_events` stores POF e-sign lifecycle traceability.
- `public.staff_auth_events` stores invite/reset/password/disable lifecycle traceability.
- Keep retention and export controls aligned with compliance requirements.
