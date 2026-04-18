import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("care plan nurse-sign flow keeps post-sign readiness pending through caregiver dispatch", () => {
  const source = readWorkspaceFile("lib/services/care-plans-supabase.ts");
  const start = source.indexOf("async function finalizeCaregiverDispatchAfterNurseSignature");
  const end = source.indexOf("async function completeCarePlanNurseSignatureWorkflow");
  const segment = start >= 0 && end > start ? source.slice(start, end) : source;

  assert.equal(segment.includes('status: shouldAutoSend ? "signed_pending_caregiver_dispatch" : "ready"'), true);
  assert.equal(segment.includes('postSignReadinessStatus: "signed_pending_caregiver_dispatch"'), true);
  assert.equal(segment.includes("await markCarePlanPostSignReady("), false);
});

test("care plan caregiver prepare RPC blocks resetting signed/finalized plans", () => {
  const migration = readWorkspaceFile("supabase/migrations/0212_care_plan_caregiver_prepare_terminal_guard.sql");

  assert.equal(migration.includes("for update;"), true);
  assert.equal(migration.includes("if v_current_status = 'signed' then"), true);
  assert.equal(migration.includes("if nullif(trim(coalesce(v_existing_final_member_file_id, '')), '') is not null then"), true);
  assert.equal(
    migration.includes("not in ('not_requested', 'ready_to_send', 'send_failed', 'sent', 'viewed', 'expired')"),
    true
  );
});
