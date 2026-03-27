import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isEnrollmentPacketEligibleLeadState } from "@/lib/canonical";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("enrollment packet lead eligibility includes Tour, EIP, and Nurture", () => {
  assert.equal(
    isEnrollmentPacketEligibleLeadState({
      requestedStage: "Tour",
      requestedStatus: "Open"
    }),
    true
  );
  assert.equal(
    isEnrollmentPacketEligibleLeadState({
      requestedStage: "EIP",
      requestedStatus: "open"
    }),
    true
  );
  assert.equal(
    isEnrollmentPacketEligibleLeadState({
      requestedStage: "Inquiry",
      requestedStatus: "Open"
    }),
    false
  );
  assert.equal(
    isEnrollmentPacketEligibleLeadState({
      requestedStage: "Inquiry",
      requestedStatus: "Nurture"
    }),
    true
  );
});

test("send enrollment packet flows use the shared eligible lead list and backend guard", () => {
  const pageSource = readWorkspaceFile("app/(portal)/sales/new-entries/send-enrollment-packet/page.tsx");
  const leadPageSource = readWorkspaceFile("app/(portal)/sales/leads/[leadId]/page.tsx");
  const leadsReadSource = readWorkspaceFile("lib/services/leads-read.ts");
  const runtimeSource = readWorkspaceFile("lib/services/enrollment-packets-send-runtime.ts");

  assert.equal(leadsReadSource.includes("listEnrollmentPacketEligibleLeadsSupabase"), true);
  assert.equal(pageSource.includes("listEnrollmentPacketEligibleLeads({ limit: 500 })"), true);
  assert.equal(leadPageSource.includes("isEnrollmentPacketEligibleLeadState({"), true);
  assert.equal(runtimeSource.includes("isEnrollmentPacketEligibleLeadState({"), true);
  assert.equal(
    runtimeSource.includes("Enrollment packet can only be sent for leads in Tour, Enrollment in Progress, or Nurture."),
    true
  );
});
