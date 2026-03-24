# Database RPC Architecture

This document defines when Memory Lane should use a Supabase/Postgres RPC, when it should not, and how database read/write boundaries should stay canonical.

## Core Rule

RPCs are for:
- authoritative business actions
- transactional multi-table workflows
- denormalized read models that power a full screen or report

RPCs are not for:
- trivial single-table fetches
- tiny helper counts that only exist to support another RPC
- pass-through wrappers around another RPC
- UI-shaped micro-queries that fragment one screen into many calls

## Preferred Boundary

Read path:

`Page/UI -> server component/action -> shared read service -> direct query/view or read-model RPC`

Write path:

`UI -> server action -> domain service -> direct table write or workflow RPC -> canonical tables/storage`

## When To Use An RPC

Use an RPC when one or more are true:
- the workflow writes to multiple tables and must be atomic
- a lifecycle transition must not partially succeed
- the workflow also writes a file/storage artifact, event, queue row, or downstream sync record
- the screen clearly needs one denormalized payload that would otherwise take many round trips
- the logic must run with one authoritative implementation in Postgres for correctness

## When Not To Use An RPC

Do not use an RPC when:
- the operation is a simple single-table CRUD action
- a view can express the read shape without parameters
- a shared TypeScript service can compose a small number of direct queries without duplicating business rules
- the function would only rename or forward to another RPC
- the function returns one narrow count or one field that belongs inside a broader read model

## Read Rules

- Prefer one canonical read path per major screen.
- If a screen needs counts, lists, and summary cards for the same domain, prefer one read-model RPC over separate helper RPCs.
- If a read model has no parameters and no security-definer need, strongly consider a view instead of an RPC.
- Keep direct table reads in shared read services, not pages.

## Write Rules

- Prefer one canonical write path per major workflow.
- Use SQL RPCs for multi-step transactional workflows and lifecycle transitions.
- Keep role checks and input validation in the action/service layer, but keep atomic persistence in one database boundary.
- Do not split one workflow across multiple thin RPCs unless each RPC owns a real independent lifecycle step.

## Naming Convention

- Read-model RPCs: `rpc_get_<domain>_<screen_or_report>`
- Workflow RPCs: `rpc_<action>_<domain_or_workflow>`
- Queue claim RPCs: `rpc_claim_<queue_or_follow_up_task>`
- Views: `v_<domain>_<read_model>`

Avoid:
- `rpc_helper_*`
- `rpc_list_*` when the function is actually a full screen read model
- names that differ only by `summary`, `counts`, `dashboard`, or `options` unless they power truly different bounded contexts

## Domain Ownership

- Sales/leads: one dashboard read model, one lead conversion write path, one stage transition path
- Enrollment/intake: one packet completion/follow-up boundary, one intake create/finalize path
- Members/MHP/MCC: one member read model per major screen, one canonical profile update path per domain
- Clinical workflows: POF signing, care plan signing, MAR administration, and downstream syncs stay on authoritative RPC boundaries
- Billing/transportation: batch generation/posting workflows stay transactional; list pages should prefer read models or direct shared queries

## Anti-Patterns

- Thin wrapper RPC:
  `rpc_a()` only does `select * from rpc_b()`
- Waterfall helper RPCs:
  one page calls `summary`, `counts`, `options`, and `timeline` separately for the same domain payload
- Parallel old/new paths:
  keeping legacy helper RPCs after all consumers move to the canonical replacement
- Mixed ownership:
  status derivation in SQL and different status derivation in TypeScript for the same concept
- Screen-specific SQL proliferation:
  adding one new RPC per card/widget instead of strengthening the existing domain read model

## Review Checklist

Before adding or keeping an RPC, answer:
- Does this represent a real business action or full read model?
- Would a direct shared query or view be simpler and clearer?
- Is this replacing an older overlapping RPC, or creating a parallel path?
- Does this reduce round trips for a real screen?
- Does this keep one obvious canonical boundary for the domain?

If the answer to the first or fourth question is `no`, do not add the RPC without a written reason.
