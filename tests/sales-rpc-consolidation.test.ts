import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("sales dashboard service reads stage counts and recent inquiries from the canonical dashboard RPC", () => {
  const source = readWorkspaceFile("lib/services/sales-crm-read-model.ts");

  assert.equal(source.includes('const SALES_DASHBOARD_SUMMARY_RPC = "rpc_get_sales_dashboard_summary"'), true);
  assert.equal(source.includes("normalizeDashboardRecentInquiries"), true);
  assert.equal(source.includes("normalizeSalesPipelineStageCounts(dashboardSummary.stage_counts)"), true);
  assert.equal(source.includes("recentInquiries: normalizeDashboardRecentInquiries(dashboardSummary.recent_inquiries)"), true);
  assert.equal(source.includes("fetchSalesPipelineSummaryCountsSupabase"), false);
});

test("sales lead list open filter uses only valid lead_status enum values", () => {
  const source = readWorkspaceFile("lib/services/sales-crm-read-model.ts");

  assert.equal(source.includes('return query.eq("status", "open");'), true);
  assert.equal(source.includes("status.eq.nurture"), false);
});

test("sales workflow helper no longer calls the thin pipeline summary RPC directly", () => {
  const source = readWorkspaceFile("lib/services/sales-workflows.ts");

  assert.equal(source.includes('const SALES_DASHBOARD_SUMMARY_RPC = "rpc_get_sales_dashboard_summary"'), true);
  assert.equal(source.includes('const SALES_PIPELINE_SUMMARY_COUNTS_RPC = "rpc_get_sales_pipeline_summary_counts"'), false);
  assert.equal(source.includes("normalizeSalesPipelineStageCounts"), true);
});

test("sales RPC consolidation migration removes thin or stale SQL entry points", () => {
  const source = readWorkspaceFile("supabase/migrations/0129_sales_dashboard_rpc_consolidation.sql");

  assert.equal(source.includes("stage_counts jsonb"), true);
  assert.equal(source.includes("recent_inquiries jsonb"), true);
  assert.equal(source.includes("drop function if exists public.rpc_get_sales_pipeline_summary_counts();"), true);
  assert.equal(source.includes("drop function if exists public.rpc_list_mar_member_options();"), true);
  assert.equal(source.includes("drop function if exists public.rpc_finalize_enrollment_packet_request_completion("), true);
});
