# Build Perf Notes

## Root Cause

Two different issues showed up during the investigation:

1. Some hot action entrypoints were eagerly importing heavyweight care-plan, POF, and MHP service graphs, which made those action-related modules much larger than they needed to be.
2. The repo had several wrapper-only server action modules that exported many tiny actions, which bloated Next's `server-reference-manifest` even though those wrappers did not own any real business logic.
3. After trimming the action surface, the remaining warning no longer points only to the manifest. The build stats and module-size audit still show a few large server chunks and large service modules with long inline string-heavy logic, especially:
   - `lib/services/enrollment-packets.ts`
   - `lib/services/billing-supabase.ts`
   - `lib/services/pof-esign.ts`
   - `lib/services/physician-orders-supabase.ts`

That means the import/action cleanup was real and effective, but there is still at least one app-owned large-string hotspot left in heavyweight service modules or the chunks they produce.

## Files Changed

- `next.config.ts`
- `app/care-plan-actions.ts`
- `app/sign/care-plan/[token]/actions.ts`
- `app/sign/pof/[token]/actions.ts`
- `app/(portal)/health/member-health-profiles/actions-impl.ts`
- `app/(portal)/operations/member-command-center/actions-impl.ts`
- `app/(portal)/time-card/director/actions.ts`
- `app/(portal)/time-card/director/pending-tab.tsx`
- `app/(portal)/time-card/director/pto-tab.tsx`
- `app/(portal)/time-card/director/forgotten-tab.tsx`
- `app/(portal)/time-card/director/export-tab.tsx`
- `app/(portal)/time-card/forgotten-punch/page.tsx`
- `app/(portal)/time-hr/user-management/page.tsx`
- `app/(portal)/time-hr/user-management/new/page.tsx`
- `app/(portal)/time-hr/user-management/[userId]/page.tsx`
- `app/(portal)/time-hr/user-management/[userId]/edit/page.tsx`
- `app/(portal)/time-hr/user-management/[userId]/permissions/page.tsx`
- `app/(auth)/login/page.tsx`
- `app/auth/forgot-password/page.tsx`
- `app/documentation-create-actions.ts`
- `app/documentation-update-actions.ts`
- `components/forms/ancillary-charge-form.tsx`
- `components/forms/daily-activity-form.tsx`
- `components/forms/documentation-workflow-forms.tsx`
- `components/forms/record-actions.tsx`
- `components/forms/user-management-form.tsx`
- `components/forms/user-permissions-form.tsx`
- `components/reports/monthly-ancillary-report.tsx`
- `lib/actions/user-management.ts`
- `lib/utils/uploaded-image-data-url.ts`

## What Changed

- `next.config.ts`
  - extended the existing build-stats plugin so it writes `.next/analyze/*.json` from `afterEmit` as well as `done`, which means stats are still available even if a later build phase fails.
  - added `warnings`, `emittedServerFiles`, and `actionBrowserFiles` to the emitted report so the biggest modules and server artifacts are easier to attribute.
- `app/care-plan-actions.ts`
  - moved `CARE_PLAN_SECTION_TYPES` to the smaller `care-plan-track-definitions` import.
  - lazy-loads `care-plans` and `care-plan-esign` service modules at call time instead of dragging them into the action entrypoint up front.
- `app/sign/care-plan/[token]/actions.ts`
  - lazy-loads `care-plan-esign` instead of importing it at module scope.
- `app/sign/pof/[token]/actions.ts`
  - lazy-loads `pof-esign` instead of importing it at module scope.
- `app/(portal)/health/member-health-profiles/actions-impl.ts`
  - removed the duplicated local image-to-data-URL helper in favor of a shared server-only utility.
- `app/(portal)/operations/member-command-center/actions-impl.ts`
  - removed the duplicated local image-to-data-URL helper in favor of the same shared utility.
- `app/documentation-update-actions.ts`
  - collapsed eight wrapper-only server action exports into one discriminated `runDocumentationUpdateAction(...)` entrypoint.
- `components/forms/record-actions.tsx`
  - now calls the single documentation update action entrypoint with explicit `kind` values instead of importing many server actions.
- `components/reports/monthly-ancillary-report.tsx`
  - now uses the same single documentation update action entrypoint for delete and reconciliation mutations.
- `app/documentation-create-actions.ts`
  - collapsed seven wrapper-only server action exports into one discriminated `runDocumentationCreateAction(...)` entrypoint.
- `components/forms/ancillary-charge-form.tsx`
  - now calls the single documentation create entrypoint.
- `components/forms/daily-activity-form.tsx`
  - now calls the single documentation create entrypoint.
- `components/forms/documentation-workflow-forms.tsx`
  - now routes toilet, shower, transportation, photo upload, and blood sugar mutations through the single documentation create entrypoint.
- `app/(portal)/time-card/director/actions.ts`
  - collapsed nine exported server actions into one `submitDirectorTimecardAction(...)` dispatcher.
  - kept the same permission checks, validation, service calls, redirects, and revalidation behavior.
- `app/(portal)/time-card/director/*.tsx`
  - forms now post a hidden `intent` field to the single director action instead of importing separate server actions.
- `app/(portal)/time-card/forgotten-punch/page.tsx`
  - now posts forgotten-punch requests through the same single director action boundary.
- `lib/actions/user-management.ts`
  - collapsed nine exported admin actions into one `submitManagedUserAction(...)` dispatcher.
  - preserved the same admin guardrails and canonical service-layer calls.
- `components/forms/user-management-form.tsx`
  - now includes an explicit hidden action `intent`.
- `components/forms/user-permissions-form.tsx`
  - now includes an explicit hidden action `intent`.
- `app/(portal)/time-hr/user-management/**/*.tsx`
  - user-management forms now post through the single dispatcher instead of separate exported actions.
- `lib/utils/uploaded-image-data-url.ts`
  - centralized the current image upload parsing/data-URL conversion logic so it is not duplicated across action modules.
- `app/(auth)/login/page.tsx`
  - marked the page `force-dynamic` so `next build` does not fail on search-param usage during prerender.
- `app/auth/forgot-password/page.tsx`
  - marked the page `force-dynamic` so auth prerendering does not break the build.

## Investigation Outcome For Base64/Data URLs

- I inspected the suspected `data:image/...;base64,...` and `signatureImageDataUrl` paths first.
- Those flows are still worth cleaning up architecturally, but the build warning did not track back to them as the primary source.
- The duplicated profile-photo helper was centralized, but runtime payload behavior was intentionally kept the same in this pass to avoid a riskier storage/read-path refactor across MHP, MCC, attendance, and face-sheet consumers.

## Before / After Evidence

- Before the import refactor:
  - the emitted action/browser artifacts included very large modules such as:
    - `_action-browser_lib_services_care-plan-esign_ts.js` at `477107` bytes
    - `_action-browser_app_portal_health_member-health-profiles_actions-impl_ts.js` at `429057` bytes
- Before the action-surface refactor:
  - `.next/server/server-reference-manifest.json` was `137371` bytes.
  - `.next/server/server-reference-manifest.js` was `150214` bytes.
- After the import refactor:
  - `.next/analyze/server.json` shows the action-related modules materially smaller:
    - `./lib/services/care-plan-esign.ts` at `32716` bytes when issued by `./app/sign/care-plan/[token]/actions.ts`
    - `./app/(portal)/health/member-health-profiles/actions-impl.ts` at `56125` bytes
  - after collapsing documentation, director-timecard, and user-management wrapper actions:
    - `.next/server/server-reference-manifest.json` dropped to `110566` bytes
    - `.next/server/server-reference-manifest.js` dropped to `120857` bytes
  - builds now complete successfully after the auth-page fixes.
- Remaining warning:
  - `npm run build` still emits:
    - `[webpack.cache.PackFileCacheStrategy] Serializing big strings (140kiB)...`
  - `.next/analyze/server.json` now shows the biggest remaining server assets in the warning band as:
    - `1331.js` at `127922` bytes
    - `app/(portal)/operations/member-command-center/[memberId]/page.js` at `127138` bytes
    - `server-reference-manifest.js` at `120857` bytes
    - `5370.js` at `116170` bytes
    - `server-reference-manifest.json` at `110566` bytes
  - `npm run audit:module-sizes` still reports large app-owned source modules including:
    - `lib/services/enrollment-packets.ts` at `91567` bytes
    - `lib/services/billing-supabase.ts` at `75270` bytes
    - `lib/services/pof-esign.ts` at `55850` bytes
    - `lib/services/physician-orders-supabase.ts` at `50042` bytes
  - current conclusion: the manifest was a major contributor, but not the only one.

## Remaining Hotspots

The stats-enabled build still points to these larger modules/assets:

- `.next/server/chunks/1331.js` at `127922` bytes
- `.next/server/app/(portal)/operations/member-command-center/[memberId]/page.js` at `127138` bytes
- `.next/server/server-reference-manifest.js` at `120857` bytes
- `.next/server/chunks/5370.js` at `116170` bytes
- `.next/server/server-reference-manifest.json` at `110566` bytes
- `lib/services/enrollment-packets.ts` at `91567` source bytes
- `lib/services/billing-supabase.ts` at `75270` source bytes
- `lib/services/pof-esign.ts` at `55850` source bytes
- `lib/services/physician-orders-supabase.ts` at `50042` source bytes

The biggest manifest contributors by server-action count are currently:

- `app/(portal)/operations/payor/actions.ts` with `17` action entries
- `app/(portal)/health/member-health-profiles/profile-actions.ts` with `7`
- `app/(portal)/health/member-health-profiles/medication-actions.ts` with `7`
- `app/(portal)/operations/member-command-center/summary-actions.ts` with `7`
- `app/(portal)/operations/transportation-station/actions.ts` with `6`
- `app/(portal)/documentation/incidents/actions.ts` with `6`
- `app/(portal)/health/member-health-profiles/provider-actions.ts` with `6`

## Commands Run

- `git status --short`
- `npm run audit:module-sizes`
- `npm run build -- --debug`
- `npm run typecheck`
- `npm run build`
- `NEXT_BUILD_STATS=1 npm run build`
- `NEXT_BUILD_STATS=1 npm run build` after the action-surface refactors
- `NEXT_BUILD_STATS=1 npm run build` after the documentation-create refactor

## Current Conclusion

- `next build` now completes successfully.
- The original investigation target was real: there were oversized action entrypoints worth trimming.
- The warning is materially narrowed but not fully gone.
- The server-action manifest was reduced a lot, but the remaining warning still points to a smaller set of heavyweight app-owned server chunks and service modules.
- The most likely next source-level fix would be to split large multi-concern services like `lib/services/enrollment-packets.ts` and `app/(portal)/operations/payor/actions.ts` along workflow boundaries so hot paths stop carrying oversized string-heavy module payloads.
