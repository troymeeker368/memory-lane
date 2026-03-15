# Workflow Hardening Rollout

This guide covers the remaining operational steps for the workflow hardening pass.

## 1. Apply The Migration

Apply migration `0049_workflow_hardening_constraints.sql` in Supabase after the preflight checks below are clean.

What it adds:
- intake draft-POF follow-up fields
- unique lead-to-member linkage
- one active enrollment packet per member
- one care-plan root per member and track

## 2. Run Preflight Checks First

Run these in Supabase SQL Editor before applying the migration.

### Duplicate lead-to-member links

```sql
select source_lead_id, count(*) as member_count, array_agg(id order by id) as member_ids
from public.members
where source_lead_id is not null
group by source_lead_id
having count(*) > 1;
```

### Duplicate active enrollment packets

```sql
select member_id, count(*) as active_packet_count, array_agg(id order by created_at desc) as packet_ids
from public.enrollment_packet_requests
where status in ('draft', 'prepared', 'sent', 'opened', 'partially_completed')
group by member_id
having count(*) > 1;
```

### Duplicate care-plan roots

```sql
select member_id, track, count(*) as root_count, array_agg(id order by created_at desc) as care_plan_ids
from public.care_plans
group by member_id, track
having count(*) > 1;
```

If any query returns rows, stop and clean the duplicates before running the migration.

## 3. Configure The POF Retry Runner

Set this environment variable in the deployed app:

```text
POF_POST_SIGN_SYNC_SECRET=<strong-random-secret>
```

The runner endpoint is:

```text
POST /api/internal/pof-post-sign-sync
```

It expects:
- `Authorization: Bearer <POF_POST_SIGN_SYNC_SECRET>`
- optional JSON body like `{ "limit": 25 }`

Example:

```bash
curl -X POST https://your-app-url/api/internal/pof-post-sign-sync \
  -H "Authorization: Bearer YOUR_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"limit":25}'
```

Recommended schedule:
- every 5 to 15 minutes
- keep `limit` between `10` and `25` unless there is a known backlog

## 4. Post-Deploy Manual Checks

### Intake
- Create and sign an intake assessment.
- Open the assessment detail page.
- Confirm `Draft POF Status` becomes `created`.

### Intake failure path
- Force or simulate a draft-POF creation failure.
- Confirm the intake remains signed.
- Confirm `Draft POF Status` becomes `failed`.
- Confirm the error message is visible on the assessment detail page.

### Enrollment packet
- Complete an enrollment packet.
- Confirm it only reaches `filed` when downstream mapping succeeds.
- If downstream mapping fails, confirm the request is left in `partially_completed` and a failure event is recorded.

### POF clinical sync
- Sign a POF.
- Confirm the physician-order screens show `Clinical Sync` as `Pending` until the cascade completes.
- Confirm queued retries are cleared by the runner endpoint.

### MAR protection
- Try documenting a scheduled MAR dose against an inactive schedule or inactive medication.
- Confirm the write is blocked and no administration record is inserted.

## 5. Staff Meaning Of New States

- `Draft POF Status = failed` means intake is signed but the draft physician order still needs repair.
- `Clinical Sync = Pending` means the POF is legally signed but downstream MHP/MAR sync is not done yet.
- `Enrollment Packet = partially_completed` means uploads may exist, but downstream relational mapping did not finish cleanly.
