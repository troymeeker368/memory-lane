# Build Perf Notes

## Root Cause

Two different issues showed up during the investigation:

1. Some hot action entrypoints were eagerly importing heavyweight care-plan, POF, and MHP service graphs, which made those action-related modules much larger than they needed to be.
2. The remaining `webpack.cache.PackFileCacheStrategy` warning lines up very closely with Next's generated `server-reference-manifest`:
   - `.next/analyze/server.json` reports `../server-reference-manifest.json` at `137371` bytes.
   - the warning reports `Serializing big strings (140kiB)`.

That means the safe import-trimming work helped real bundle pressure, but the warning that still remains is now primarily tied to the repo's overall server-action surface area and the manifest Next generates for it.

## Files Changed

- `next.config.ts`
- `app/care-plan-actions.ts`
- `app/sign/care-plan/[token]/actions.ts`
- `app/sign/pof/[token]/actions.ts`
- `app/(portal)/health/member-health-profiles/actions-impl.ts`
- `app/(portal)/operations/member-command-center/actions-impl.ts`
- `app/(auth)/login/page.tsx`
- `app/auth/forgot-password/page.tsx`
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
- After the import refactor:
  - `.next/analyze/server.json` shows the action-related modules materially smaller:
    - `./lib/services/care-plan-esign.ts` at `32716` bytes when issued by `./app/sign/care-plan/[token]/actions.ts`
    - `./app/(portal)/health/member-health-profiles/actions-impl.ts` at `56125` bytes
  - builds now complete successfully after the auth-page fixes.
- Remaining warning:
  - `npm run build` still emits:
    - `[webpack.cache.PackFileCacheStrategy] Serializing big strings (140kiB)...`
  - `.next/analyze/server.json` shows:
    - `../server-reference-manifest.json` at `137371` bytes
    - `../server-reference-manifest.js` at `150214` bytes
  - this is the clearest current explanation for why the warning remains.

## Remaining Hotspots

The stats-enabled build still points to these larger modules/assets:

- `../server-reference-manifest.json` at `137371` bytes
- `../server-reference-manifest.js` at `150214` bytes
- `lib/services/enrollment-packets.ts` at roughly `157-158 KB` in the server stats
- `lib/services/pof-esign.ts` at roughly `75-85 KB`
- `lib/services/care-plans-supabase.ts` at roughly `51 KB`
- `lib/services/care-plan-esign.ts` at roughly `45 KB`
- `lib/services/member-health-profiles/actions-impl.ts` at roughly `56 KB`

The biggest manifest contributors by server-action count are currently:

- `app/(portal)/operations/payor/actions.ts` with `17` action entries
- `app/(portal)/time-card/director/actions.ts` with `9`
- `lib/actions/user-management.ts` with `9`
- `app/documentation-update-actions.ts` with `8`
- multiple MHP and MCC action wrapper files with `5-7` entries each

## Commands Run

- `git status --short`
- `npm run audit:module-sizes`
- `npm run build -- --debug`
- `npm run typecheck`
- `npm run build`
- `NEXT_BUILD_STATS=1 npm run build`

## Current Conclusion

- `next build` now completes successfully.
- The original investigation target was real: there were oversized action entrypoints worth trimming.
- The warning is not fully gone.
- The remaining warning is now best explained by Next's large generated server-action manifest plus a few still-heavy shared service modules.
- Fully eliminating the warning would likely require a larger follow-up that reduces total server-action manifest size, especially in the highest-count action files, rather than more base64 helper cleanup alone.
