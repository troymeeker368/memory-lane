import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("dashboard ancillary snapshot is loaded through a shared service helper", () => {
  const pageSource = readWorkspaceFile("app/(portal)/dashboard/page.tsx");
  const serviceSource = readWorkspaceFile("lib/services/dashboard.ts");

  assert.equal(pageSource.includes('import { createClient } from "@/lib/supabase/server";'), false);
  assert.equal(pageSource.includes("listDashboardAncillaryChargesForMonth(today)"), true);
  assert.equal(pageSource.includes('from("ancillary_charge_logs")'), false);
  assert.equal(serviceSource.includes("export async function listDashboardAncillaryChargesForMonth"), true);
});

test("member command center reads no longer backfill canonical shells", () => {
  const source = readWorkspaceFile("lib/services/member-command-center-runtime.ts");

  assert.equal(source.includes("await backfillMissingMemberCommandCenterRowsSupabase(memberIds);"), false);
  assert.equal(source.includes("await backfillMissingMemberCommandCenterRowsSupabase([canonicalMemberId]);"), false);
  assert.equal(source.includes("npm run repair:historical-drift -- --apply"), true);
});

test("member file downloads fail explicitly instead of repairing storage on read", () => {
  const source = readWorkspaceFile("lib/services/member-files.ts");

  const downloadSection = source.slice(
    source.indexOf("export async function getMemberFileDownloadUrl"),
    source.indexOf("export async function saveManualMemberFile")
  );

  assert.equal(downloadSection.includes("backfillLegacyMemberFileStorage"), false);
  assert.equal(downloadSection.includes("npm run backfill:member-files"), true);
});

test("operational settings reads no longer self-heal the singleton row", () => {
  const source = readWorkspaceFile("lib/services/operations-settings.ts");

  const readSection = source.slice(
    source.indexOf("export async function getOperationalSettings"),
    source.indexOf("export async function repairOperationalSettingsSingleton")
  );

  assert.equal(readSection.includes("createClient({ serviceRole: true })"), false);
  assert.equal(readSection.includes('.upsert(defaultOperationalSettingsRow()'), false);
  assert.equal(readSection.includes('Missing required operations_settings singleton row with id "default".'), true);
});

test("historical drift repair is exposed as an explicit runner", () => {
  const packageSource = readWorkspaceFile("package.json");
  const scriptSource = readWorkspaceFile("scripts/repair-historical-drift.ts");
  const operationsSettingsSource = readWorkspaceFile("lib/services/operations-settings.ts");

  assert.equal(packageSource.includes('"repair:historical-drift"'), true);
  assert.equal(scriptSource.includes("repairOperationalSettingsSingleton"), true);
  assert.equal(scriptSource.includes("backfillMissingMemberCommandCenterRowsSupabase"), true);
  assert.equal(scriptSource.includes("backfillLegacyMemberFileStorageBatch"), true);
  assert.equal(operationsSettingsSource.includes("export async function repairOperationalSettingsSingleton"), true);
});
