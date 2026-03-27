import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("intake action keeps committed draft POF reload misses out of the false-failure path", () => {
  const intakeActionSource = readWorkspaceFile("app/intake-actions.ts");
  const retryActionSource = readWorkspaceFile("app/(portal)/health/assessment/[assessmentId]/actions.ts");
  const readinessSource = readWorkspaceFile("lib/services/intake-post-sign-readiness.ts");

  assert.equal(intakeActionSource.includes("CommittedDraftPhysicianOrderReloadError"), true);
  assert.equal(intakeActionSource.includes('status: committedReloadMiss ? "created" : "failed"'), true);
  assert.equal(intakeActionSource.includes("Draft POF Verification Follow-up Needed"), true);
  assert.equal(
    intakeActionSource.includes("draft POF was committed, but immediate readback verification still needs follow-up"),
    true
  );
  assert.equal(retryActionSource.includes("CommittedDraftPhysicianOrderReloadError"), true);
  assert.equal(retryActionSource.includes('status: "created"'), true);
  assert.equal(readinessSource.includes('"signed_pending_draft_pof_readback"'), true);
});

test("follow-up dashboard uses the paginated canonical read model instead of loading all open leads", () => {
  const pageSource = readWorkspaceFile("app/(portal)/sales/pipeline/follow-up-dashboard/page.tsx");
  const leadsReadSource = readWorkspaceFile("lib/services/leads-read.ts");
  const crmSource = readWorkspaceFile("lib/services/sales-crm-read-model.ts");

  assert.equal(pageSource.includes("getLeadFollowUpDashboard"), true);
  assert.equal(pageSource.includes("SALES_PIPELINE_PAGE_SIZE"), true);
  assert.equal(pageSource.includes("Page {dashboard.page} of {dashboard.totalPages}"), true);
  assert.equal(leadsReadSource.includes("getLeadFollowUpDashboard"), true);
  assert.equal(crmSource.includes("getSalesLeadFollowUpDashboardSupabase"), true);
  assert.equal(crmSource.includes('status: "open"'), true);
  assert.equal(crmSource.includes('sort: "next_follow_up"'), true);
});

test("member health profile directory writes no longer pick the most recently updated fuzzy match", () => {
  const source = readWorkspaceFile("lib/services/member-health-profiles-write-supabase.ts");

  assert.equal(source.includes('.order("updated_at", { ascending: false })'), false);
  assert.equal(source.includes(".limit(1)"), false);
  assert.equal(source.includes("loadProviderDirectoryRow"), true);
  assert.equal(source.includes('ilike("provider_name", input.providerName)'), true);
  assert.equal(source.includes('ilike("practice_name", input.practiceName)'), true);
  assert.equal(source.includes('practice_name.is.null,practice_name.eq.'), true);
  assert.equal(source.includes('ilike("hospital_name", hospitalName)'), true);
});
