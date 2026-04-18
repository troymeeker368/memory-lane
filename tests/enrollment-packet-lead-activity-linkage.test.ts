import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("enrollment packet completion lead activity uses canonical packet id linkage", () => {
  const migrationSource = readFileSync("supabase/migrations/0215_lead_activity_enrollment_packet_link.sql", "utf8");
  const completionCascadeSource = readFileSync("lib/services/enrollment-packet-completion-cascade.ts", "utf8");
  const mappingRuntimeSource = readFileSync("lib/services/enrollment-packet-mapping-runtime.ts", "utf8");

  assert.equal(migrationSource.includes("add column if not exists enrollment_packet_request_id uuid"), true);
  assert.equal(
    migrationSource.includes("foreign key (enrollment_packet_request_id)"),
    true
  );
  assert.equal(
    completionCascadeSource.includes('.eq("enrollment_packet_request_id", input.packetId)'),
    true
  );
  assert.equal(
    completionCascadeSource.includes('.in("enrollment_packet_request_id", packetIds)'),
    true
  );
  assert.equal(
    mappingRuntimeSource.includes("enrollment_packet_request_id: input.enrollmentPacketRequestId"),
    true
  );
});
