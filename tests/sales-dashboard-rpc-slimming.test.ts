import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("sales dashboard slimming migration folds lead-wide counts into the canonical lead summary pass", () => {
  const migrationSource = readFileSync("supabase/migrations/0209_sales_dashboard_summary_lead_count_slimming.sql", "utf8");
  const workflowSource = readFileSync("lib/services/sales-workflows.ts", "utf8");

  assert.equal(migrationSource.includes("canonical_leads as ("), true);
  assert.equal(migrationSource.includes("resolved_leads as ("), true);
  assert.equal(migrationSource.includes("summary_counts.total_lead_count"), true);
  assert.equal(migrationSource.includes("summary_counts.converted_or_enrolled_count"), true);
  assert.equal(migrationSource.includes("summary_counts.recent_inquiry_activity_count"), true);
  assert.equal(migrationSource.includes("(select count(*)::bigint from public.leads) as total_lead_count"), false);
  assert.equal(workflowSource.includes('const SALES_DASHBOARD_SUMMARY_MIGRATION = "0209_sales_dashboard_summary_lead_count_slimming.sql";'), true);
});

