# Admin Guide

## Managing Staff Roles

1. Create user in Supabase Auth (email/password).
2. Insert or update matching row in `public.profiles` with same `id` as `auth.users.id`.
3. Set `role` to one of: `admin`, `manager`, `nurse`, `staff`.
4. Set `active = true` to allow access.

Example:

```sql
update public.profiles
set role = 'manager', active = true
where email = 'manager@example.com';
```

## Managing Lookup Data

- Use `public.lookup_lists` for dropdown values.
- `list_name` examples: `lead_stage`, `lead_source`, `follow_up_type`.
- Set `active = false` to retire a value without deleting history.

Example:

```sql
insert into public.lookup_lists (list_name, value, sort_order)
values ('lead_source', 'Hospital Partner', 6)
on conflict (list_name, value) do nothing;
```

## Managing Ancillary Categories

```sql
insert into public.ancillary_charge_categories (name, price_cents)
values ('Special Transport', 3000)
on conflict (name) do update set price_cents = excluded.price_cents;
```

## Audit and Email Logs

- Audit rows are in `public.audit_logs`.
- Outbound lead communication rows should be written to `public.email_logs`.
- Recommended retention: minimum 24 months for compliance traceability.
