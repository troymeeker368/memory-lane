import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  assertCanonicalMemberResolverInput,
  toCanonicalMemberRefInput
} from "@/lib/services/canonical-member-ref-input";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("canonical member ref input preserves a direct canonical memberId without selectedId padding", () => {
  const normalized = toCanonicalMemberRefInput({ memberId: "4cfd8574-36a5-4fda-a292-c8e6da1c00e5" });

  assert.equal(normalized.sourceType, "member");
  assert.equal(normalized.memberId, "4cfd8574-36a5-4fda-a292-c8e6da1c00e5");
  assert.equal(normalized.selectedId, undefined);
});

test("route param memberId string normalizes to the canonical member contract", () => {
  const normalized = toCanonicalMemberRefInput("4cfd8574-36a5-4fda-a292-c8e6da1c00e5");

  assert.equal(normalized.sourceType, "member");
  assert.equal(normalized.memberId, "4cfd8574-36a5-4fda-a292-c8e6da1c00e5");
  assert.equal(normalized.selectedId, undefined);
});

test("mixed member payload keeps direct memberId even when selectedId is omitted", () => {
  const normalized = toCanonicalMemberRefInput({
    memberId: "4cfd8574-36a5-4fda-a292-c8e6da1c00e5",
    leadId: "ea792c37-f318-40dd-8aad-f251d5ee32d0"
  });

  assert.equal(normalized.sourceType, "member");
  assert.equal(normalized.memberId, "4cfd8574-36a5-4fda-a292-c8e6da1c00e5");
  assert.equal(normalized.leadId, "ea792c37-f318-40dd-8aad-f251d5ee32d0");
  assert.equal(normalized.selectedId, undefined);
});

test("truly invalid member-resolution payloads still fail loudly", () => {
  assert.throws(
    () => assertCanonicalMemberResolverInput({}, "listCarePlanRows"),
    /listCarePlanRows requires memberId, selectedId, leadId, externalId, or legacyId/
  );
});

test("care plan, MHP, and route loaders now share the canonical member-id boundary", () => {
  const carePlansSource = readWorkspaceFile("lib/services/care-plans-supabase.ts");
  const mhpSource = readWorkspaceFile("lib/services/member-health-profiles-supabase.ts");
  const latestRouteSource = readWorkspaceFile("app/(portal)/health/care-plans/member/[memberId]/latest/page.tsx");
  const mccPageSource = readWorkspaceFile("app/(portal)/operations/member-command-center/[memberId]/page.tsx");

  assert.equal(carePlansSource.includes('return resolveCanonicalMemberId(rawMemberId, { actionLabel });'), true);
  assert.equal(carePlansSource.includes('resolveCarePlanMemberId(filters.memberId, "listCarePlanRows")'), true);
  assert.equal(carePlansSource.includes('resolveCarePlanMemberId(memberId, "getMemberCarePlanSummary")'), true);

  assert.equal(
    mhpSource.includes('const canonicalMemberId = await resolveCanonicalMemberId(memberId, { actionLabel: "getMemberHealthProfileDetailSupabase" });'),
    true
  );
  assert.equal(mhpSource.includes('.eq("id", canonicalMemberId)'), true);

  assert.equal(
    latestRouteSource.includes('const canonicalMemberId = await resolveCanonicalMemberId(memberId, { actionLabel: "LatestMemberCarePlanPage" });'),
    true
  );
  assert.equal(latestRouteSource.includes('redirect(`/health/care-plans/new?memberId=${canonicalMemberId}`);'), true);

  assert.equal(mccPageSource.includes("getAvailableLockerNumbersForMemberSupabase(detail.member.id)"), true);
});

test("documentation actions and member document services removed local memberId coercion padding", () => {
  const documentationActionsSource = readWorkspaceFile("app/documentation-actions-impl.ts");
  const memberFilesSource = readWorkspaceFile("lib/services/member-files.ts");
  const ancillarySource = readWorkspaceFile("lib/services/ancillary-write-supabase.ts");

  assert.equal(
    documentationActionsSource.includes('import { resolveActionMemberIdentity } from "@/app/action-helpers";'),
    true
  );
  assert.equal(documentationActionsSource.includes("selectedId: memberId"), false);

  assert.equal(memberFilesSource.includes("resolveCanonicalMemberId(input.memberId"), true);
  assert.equal(memberFilesSource.includes("selectedId: input.memberId"), false);

  assert.equal(ancillarySource.includes("resolveCanonicalMemberId(input.memberId"), true);
  assert.equal(ancillarySource.includes("selectedId: input.memberId"), false);
});
