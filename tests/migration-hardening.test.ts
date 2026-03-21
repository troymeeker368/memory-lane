import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("0017 archives duplicate linked punches instead of blind hard deletes", () => {
  const source = readWorkspaceFile("supabase/migrations/0017_reseed_schema_alignment.sql");

  assert.equal(source.includes("punches_linked_time_punch_review"), true);
  assert.equal(source.includes("queued for archive review"), true);
  assert.equal(source.includes("archive_reason"), true);
  assert.equal(source.includes("0017 abort:"), true);
});

test("0038 performs deterministic duplicate remediation before adding uniqueness guards", () => {
  const source = readWorkspaceFile("supabase/migrations/0038_acid_uniqueness_guards.sql");

  assert.equal(source.includes("0038 uniqueness preflight"), true);
  assert.equal(source.includes("status = 'expired'"), true);
  assert.equal(source.includes("status = 'superseded'"), true);
  assert.equal(source.includes("legacy-detached-pof-request"), true);
  assert.equal(source.includes("0038 abort:"), true);
});

test("0068 resolves duplicate payor flags before enforcing one-payor-per-member", () => {
  const source = readWorkspaceFile("supabase/migrations/0068_member_contacts_is_payor_schema_alignment.sql");

  assert.equal(source.includes("0068 member_contacts payor preflight"), true);
  assert.equal(source.includes("responsible party"), true);
  assert.equal(source.includes("duplicate groups remain after deterministic cleanup"), true);
  assert.equal(source.includes("alter column is_payor set not null"), true);
});

test("0099 follow-up migration applies upgraded-env constraint parity for 0015", () => {
  const source = readWorkspaceFile("supabase/migrations/0099_schema_compatibility_constraint_hardening.sql");

  assert.equal(source.includes("0099 abort: closure_rules"), true);
  assert.equal(source.includes("care_plan_sections_care_plan_id_section_type_key"), true);
  assert.equal(source.includes("billing_invoices_invoice_source_check"), true);
  assert.equal(source.includes("transportation_logs_billing_status_check"), true);
  assert.equal(source.includes("validate constraint"), true);
});

test("0106 moves enrollment contact/payor writes into the conversion RPC and adds intake follow-up queue backing", () => {
  const source = readWorkspaceFile("supabase/migrations/0106_enrollment_atomicity_and_intake_follow_up_queue.sql");

  assert.equal(source.includes("create table if not exists public.intake_post_sign_follow_up_queue"), true);
  assert.equal(source.includes("task_type in ('draft_pof_creation', 'member_file_pdf_persistence')"), true);
  assert.equal(source.includes("insert into public.member_contacts"), true);
  assert.equal(source.includes("update public.member_contacts as mc"), true);
  assert.equal(source.includes("perform public.rpc_set_member_contact_payor(p_member_id, v_payor_contact_id);"), true);
});
