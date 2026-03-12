import assert from "node:assert/strict";
import test from "node:test";

import {
  CARE_PLAN_LONG_TERM_LABEL,
  CARE_PLAN_REVIEW_OPTIONS,
  CARE_PLAN_SHORT_TERM_LABEL,
  getCarePlanTrackDefinition
} from "@/lib/services/care-plan-track-definitions";
import { canAccessCarePlansForRole, isCarePlanAuthorizedRole } from "@/lib/services/care-plan-authorization";
import {
  canSendCaregiverSignatureByNurseSignedAt,
  resolvePublicCaregiverLinkState
} from "@/lib/services/care-plan-esign-rules";

test("track wording matches canonical source for Track 1/2/3", () => {
  const track1 = getCarePlanTrackDefinition("Track 1");
  const track2 = getCarePlanTrackDefinition("Track 2");
  const track3 = getCarePlanTrackDefinition("Track 3");

  assert.equal(track1.title, "Member Care Plan: Track 1");
  assert.equal(track2.title, "Member Care Plan: Track 2");
  assert.equal(track3.title, "Member Care Plan: Track 3");

  assert.equal(track1.sections[0]?.shortTermGoals[0], "Member will complete daily self-care tasks (dressing, grooming, toileting) independently with minimal reminders.");
  assert.equal(track2.sections[0]?.shortTermGoals[0], "Member will complete self-care tasks (dressing, grooming, toileting) with verbal or visual prompts as needed.");
  assert.equal(track3.sections[0]?.shortTermGoals[0], "Member will participate in daily self-care routines with frequent verbal prompts and partial assistance as needed.");

  assert.equal(CARE_PLAN_SHORT_TERM_LABEL, "Short-Term Goals (within 60 days):");
  assert.equal(CARE_PLAN_LONG_TERM_LABEL, "Long-Term Goals (within 6 months):");
  assert.deepEqual(CARE_PLAN_REVIEW_OPTIONS, ["No changes needed", "Modifications required (describe below)"]);
});

test("care-plan access is Nurse/Admin only", () => {
  assert.equal(isCarePlanAuthorizedRole("admin"), true);
  assert.equal(isCarePlanAuthorizedRole("nurse"), true);
  assert.equal(isCarePlanAuthorizedRole("manager"), false);
  assert.equal(isCarePlanAuthorizedRole("director"), false);
  assert.equal(isCarePlanAuthorizedRole("coordinator"), false);

  assert.equal(canAccessCarePlansForRole("admin"), true);
  assert.equal(canAccessCarePlansForRole("nurse"), true);
  assert.equal(canAccessCarePlansForRole("sales"), false);
  assert.equal(canAccessCarePlansForRole("program-assistant"), false);
});

test("caregiver send is blocked until nurse/admin signature is completed", () => {
  const blocked = canSendCaregiverSignatureByNurseSignedAt(null);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "Care plan must be signed by Nurse/Admin before caregiver send.");

  const allowed = canSendCaregiverSignatureByNurseSignedAt("2026-03-12T10:00:00.000Z");
  assert.equal(allowed.allowed, true);
});

test("public caregiver signing link state requires valid status and non-expired token", () => {
  const future = "2099-01-01T00:00:00.000Z";
  const past = "2000-01-01T00:00:00.000Z";

  assert.equal(resolvePublicCaregiverLinkState({ status: "sent", expiresAt: future }), "ready");
  assert.equal(resolvePublicCaregiverLinkState({ status: "viewed", expiresAt: future }), "ready");
  assert.equal(resolvePublicCaregiverLinkState({ status: "signed", expiresAt: future }), "completed");
  assert.equal(resolvePublicCaregiverLinkState({ status: "expired", expiresAt: future }), "expired");
  assert.equal(resolvePublicCaregiverLinkState({ status: "sent", expiresAt: past }), "expired");
  assert.equal(resolvePublicCaregiverLinkState({ status: "not_requested", expiresAt: future }), "invalid");
});

test("legacy template wording does not appear in canonical care-plan definitions", () => {
  const allText = ["Track 1", "Track 2", "Track 3"]
    .flatMap((track) => getCarePlanTrackDefinition(track as "Track 1" | "Track 2" | "Track 3").sections)
    .flatMap((section) => [...section.shortTermGoals, ...section.longTermGoals])
    .join(" ")
    .toLowerCase();

  assert.equal(allText.includes("minimal cueing"), false);
  assert.equal(allText.includes("member participates with structured prompts"), false);
  assert.equal(allText.includes("hands-on support"), false);
  assert.equal(allText.includes("maintain engagement in"), false);
  assert.equal(allText.includes("weekly team rounds"), false);
});
