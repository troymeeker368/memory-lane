import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("0207 query hardening migration covers open alerts and MHP directory search indexes", () => {
  const migrationSource = readFileSync("supabase/migrations/0207_system_events_open_alert_and_mhp_trgm_indexes.sql", "utf8");
  const observabilitySource = readFileSync("lib/services/workflow-observability.ts", "utf8");
  const mhpSource = readFileSync("lib/services/member-health-profiles-supabase.ts", "utf8");

  assert.equal(migrationSource.includes("create extension if not exists pg_trgm;"), true);
  assert.equal(migrationSource.includes("idx_system_events_open_alert_lookup"), true);
  assert.equal(migrationSource.includes("event_type = 'system_alert' and status = 'open'"), true);
  assert.equal(migrationSource.includes("idx_provider_directory_provider_name_trgm"), true);
  assert.equal(migrationSource.includes("idx_hospital_preference_directory_hospital_name_trgm"), true);

  assert.equal(observabilitySource.includes('.eq("event_type", "system_alert")'), true);
  assert.equal(observabilitySource.includes('.eq("status", "open")'), true);
  assert.equal(observabilitySource.includes('.eq("entity_type", input.entityType)'), true);
  assert.equal(observabilitySource.includes('.eq("correlation_id", correlationId)'), true);

  assert.equal(mhpSource.includes('.ilike("provider_name"'), true);
  assert.equal(mhpSource.includes('.ilike("hospital_name"'), true);
});
