# Build Perf Notes

## Root Cause

This warning had more than one contributor:

1. Wrapper-heavy server action modules were inflating Next's `server-reference-manifest`.
2. Some hot action entrypoints were eagerly importing large service graphs.
3. A very large client module, `components/enrollment-packets/enrollment-packet-public-form.tsx`, was compiling into a single oversized source string.

The original `data:image/...;base64,...` suspicion was worth investigating, but it was not the primary build-cache cause in this repo.

## What Changed

- `next.config.ts`
  - extended the existing build-stats plugin so it writes `.next/analyze/*.json` from both `afterEmit` and `done`
  - added emitted asset/module/chunk reporting
  - added `moduleSources` reporting so builds now show the largest compiled module source strings directly
- `app/care-plan-actions.ts`
  - lazy-loads heavy care-plan services
- `app/sign/care-plan/[token]/actions.ts`
  - lazy-loads care-plan e-sign service code
- `app/sign/pof/[token]/actions.ts`
  - lazy-loads POF e-sign service code
- `lib/utils/uploaded-image-data-url.ts`
  - centralized duplicated uploaded-image data URL conversion logic
- `app/(portal)/health/member-health-profiles/actions-impl.ts`
  - switched to the shared uploaded-image helper
- `app/(portal)/operations/member-command-center/actions-impl.ts`
  - switched to the shared uploaded-image helper
- `app/documentation-update-actions.ts`
  - collapsed wrapper-only update actions into one dispatcher
- `app/documentation-create-actions.ts`
  - collapsed wrapper-only create actions into one dispatcher
- `app/documentation-create-actions-impl.ts`
  - isolates the create-side documentation implementation behind the new dispatcher
- `app/(portal)/time-card/director/actions.ts`
  - collapsed multiple director actions into one intent-driven action
- `lib/actions/user-management.ts`
  - collapsed multiple user-management actions into one intent-driven action
- `app/(portal)/operations/payor/actions.ts`
  - reduced the public action surface to a single dispatcher
- `app/(portal)/operations/payor/actions-impl.ts`
  - moved the heavy billing implementation behind a lazy-loaded action implementation module
- `app/(portal)/operations/member-command-center/attendance-billing/page.tsx`
- `app/(portal)/operations/payor/billing-agreements/page.tsx`
- `app/(portal)/operations/payor/billing-batches/page.tsx`
- `app/(portal)/operations/payor/center-closures/page.tsx`
- `app/(portal)/operations/payor/custom-invoices/page.tsx`
- `app/(portal)/operations/payor/exports/page.tsx`
- `app/(portal)/operations/payor/schedule-templates/page.tsx`
- `app/(portal)/operations/payor/variable-charges/page.tsx`
- `components/forms/billing-custom-invoice-forms.tsx`
- `components/forms/billing-manual-adjustment-form.tsx`
  - all switched to the single payor dispatcher with explicit hidden `intent` values
- `lib/services/enrollment-packet-mapping-runtime.ts`
  - extracted mapping/runtime helpers out of `lib/services/enrollment-packets.ts`
- `lib/services/enrollment-packets.ts`
  - now delegates mapping/runtime helpers to the extracted module
- `app/api/internal/enrollment-packet-mapping-sync/route.ts`
  - imports mapping retry logic from the new narrower runtime module
- `components/enrollment-packets/enrollment-packet-public-form.tsx`
  - split large legal/agreement/render blocks into child modules so the main client module no longer compiles as a 140k+ source string
- `components/enrollment-packets/enrollment-packet-public-form-agreements.tsx`
  - extracted sections 11-13
- `components/enrollment-packets/enrollment-packet-public-form-legal.tsx`
  - extracted sections 14-19
- `components/enrollment-packets/enrollment-packet-public-form-types.ts`
  - shared enrollment-packet form types for the split modules
- `app/(auth)/login/page.tsx`
- `app/auth/forgot-password/page.tsx`
  - marked auth pages `force-dynamic` so build/prerender succeeds

## Before / After Evidence

### Server action manifest

- Before action-surface refactors:
  - `.next/server/server-reference-manifest.json`: `137371`
  - `.next/server/server-reference-manifest.js`: `150214`
- After dispatcher consolidation and payor collapse:
  - `.next/server/server-reference-manifest.json`: `88012`
  - `.next/server/server-reference-manifest.js`: `96351`

### App-owned oversized source modules

Compiler-side `moduleSources` reporting showed:

- Before enrollment-packet form split:
  - `components/enrollment-packets/enrollment-packet-public-form.tsx`: about `168365` bytes of compiled source
- After extracting legal/review/signature sections:
  - `components/enrollment-packets/enrollment-packet-public-form.tsx`: about `147542`
- After extracting sections 11-13 as well:
  - `components/enrollment-packets/enrollment-packet-public-form.tsx`: about `119908`

That means the largest app-owned module that was clearly above the warning band is now below it.

### Remaining warning attribution

`next build` still prints:

- `[webpack.cache.PackFileCacheStrategy] Serializing big strings (140kiB)...`

But the current `moduleSources` report shows the remaining modules above that size are now third-party / framework sources:

- `node_modules/next/dist/compiled/react-dom/cjs/react-dom-server.node.production.js`: `262747`
- `node_modules/next/dist/compiled/react-dom/cjs/react-dom-server-legacy.node.production.js`: `238812`
- `node_modules/@supabase/auth-js/dist/module/GoTrueClient.js`: `143130`

At this point the warning is no longer being driven by the largest app-owned module we identified.

## Base64 / Data URL Investigation Outcome

- I searched the expected `data:image`, `base64,`, `signatureImageDataUrl`, `asUploadedImageDataUrl`, `toString("base64")`, and related paths.
- I centralized duplicated uploaded-image helper logic where it was duplicated.
- I did not do a storage-schema rewrite for signature or image persistence in this pass, because the build warning did not trace back primarily to those flows and a storage-path rewrite would be much riskier.

## Remaining Known Hotspots

Large app-owned modules still worth future cleanup:

- `lib/services/enrollment-packets.ts`
- `lib/services/billing-supabase.ts`
- `lib/services/pof-esign.ts`
- `lib/services/physician-orders-supabase.ts`

Those are still good candidates for future concern-splitting, but they were not the clearest remaining source of the current 140kiB warning once `moduleSources` attribution was added.

## Commands Run

- `git status --short`
- `npm run audit:module-sizes`
- `npm run build -- --debug`
- `npm run typecheck`
- `npm run build`
- `$env:NEXT_BUILD_STATS='1'; npm run build`
- `Get-ChildItem '.next\\server\\server-reference-manifest*' | Select-Object Name,Length`
- `Get-Content '.next\\analyze\\server.json' -Raw | ConvertFrom-Json`

## Current Conclusion

- `next build` completes successfully.
- The biggest app-owned contributors were materially reduced.
- The server-action manifest was materially reduced.
- The largest app-owned oversized compiled source module identified by build diagnostics was reduced below the warning threshold.
- The remaining warning appears to be driven by framework / dependency module sources, especially React server renderer code and Supabase Auth's `GoTrueClient`, not by the original app-owned hotspots that were fixed in this pass.
