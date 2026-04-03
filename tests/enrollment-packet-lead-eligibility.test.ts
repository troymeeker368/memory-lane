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
  const standaloneActionSource = readWorkspaceFile("components/sales/sales-enrollment-packet-standalone-action.tsx");
  const leadPageSource = readWorkspaceFile("app/(portal)/sales/leads/[leadId]/page.tsx");
  const leadsReadSource = readWorkspaceFile("lib/services/leads-read.ts");
  const crmSource = readWorkspaceFile("lib/services/sales-crm-read-model.ts");
  const migrationSource = readWorkspaceFile("supabase/migrations/0184_enrollment_packet_eligible_lead_sort_index.sql");
  const runtimeSource = readWorkspaceFile("lib/services/enrollment-packets-send-runtime.ts");

  assert.equal(pageSource.includes("SalesEnrollmentPacketStandaloneAction"), true);
  assert.equal(standaloneActionSource.includes("EligibleLeadSearchPicker"), true);
  assert.equal(leadsReadSource.includes("listEnrollmentPacketEligibleLeadPickerSupabase"), true);
  assert.equal(pageSource.includes("listEnrollmentPacketEligibleLeads({ limit: 500 })"), false);
  assert.equal(crmSource.includes("SALES_ENROLLMENT_PACKET_ELIGIBLE_SELECT"), true);
  assert.equal(crmSource.includes("ENROLLMENT_PACKET_ELIGIBLE_LEAD_STAGES"), true);
  assert.equal(crmSource.includes('.order("inquiry_date", { ascending: false, nullsFirst: false })'), true);
  assert.equal(crmSource.includes("caregiver_email"), true);
  assert.equal(migrationSource.includes("inquiry_date desc, member_name"), true);
  assert.equal(migrationSource.includes("where status = 'open'"), true);
  assert.equal(leadPageSource.includes("isEnrollmentPacketEligibleLeadState({"), true);
  assert.equal(runtimeSource.includes("isEnrollmentPacketEligibleLeadState({"), true);
  assert.equal(
    runtimeSource.includes("Enrollment packet can only be sent for leads in Tour, Enrollment in Progress, or Nurture."),
    true
  );
});
