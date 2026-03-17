import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  buildBillingInvoiceDocumentModel,
  buildBillingInvoicePdfBytes
} from "../lib/services/billing-invoice-document";
import {
  formatBillingPayorDisplayName,
  resolveBillingPayorContactRows,
  type BillingPayorContact
} from "../lib/services/billing-payor-contacts";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function createPayor(overrides: Partial<BillingPayorContact> = {}): BillingPayorContact {
  return {
    status: "ok",
    contact_id: "contact-1",
    member_id: "member-1",
    full_name: "Jamie Carter",
    relationship_to_member: "Daughter",
    email: "jamie@example.com",
    cellular_number: "803-555-1111",
    work_number: null,
    home_number: null,
    phone: "803-555-1111",
    address_line_1: "123 Oak Street",
    address_line_2: null,
    city: "Fort Mill",
    state: "SC",
    postal_code: "29715",
    quickbooks_customer_id: null,
    multiple_contact_ids: [],
    ...overrides
  };
}

test("billing payor resolver returns missing when no contact is flagged", () => {
  const resolved = resolveBillingPayorContactRows("member-1", []);

  assert.equal(resolved.status, "missing");
  assert.equal(formatBillingPayorDisplayName(resolved), "No payor contact designated");
});

test("billing payor resolver returns invalid_multiple when more than one contact is flagged", () => {
  const resolved = resolveBillingPayorContactRows("member-1", [
    {
      id: "contact-1",
      member_id: "member-1",
      contact_name: "Jamie Carter",
      relationship_to_member: "Daughter",
      email: "jamie@example.com",
      cellular_number: "803-555-1111",
      work_number: null,
      home_number: null,
      street_address: "123 Oak Street",
      city: "Fort Mill",
      state: "SC",
      zip: "29715",
      is_payor: true
    },
    {
      id: "contact-2",
      member_id: "member-1",
      contact_name: "Alex Carter",
      relationship_to_member: "Son",
      email: "alex@example.com",
      cellular_number: "803-555-2222",
      work_number: null,
      home_number: null,
      street_address: "456 Pine Street",
      city: "Fort Mill",
      state: "SC",
      zip: "29715",
      is_payor: true
    }
  ]);

  assert.equal(resolved.status, "invalid_multiple");
  assert.deepEqual(resolved.multiple_contact_ids, ["contact-1", "contact-2"]);
});

test("invoice document model builds Bill To from canonical payor contact", () => {
  const model = buildBillingInvoiceDocumentModel({
    invoice: {
      id: "invoice-1",
      invoice_number: "INV-202603-0001",
      invoice_month: "2026-03-01",
      invoice_status: "Draft",
      invoice_date: "2026-03-17",
      due_date: "2026-04-16",
      member_id: "member-1",
      base_period_start: "2026-03-01",
      base_period_end: "2026-03-31",
      variable_charge_period_start: "2026-03-01",
      variable_charge_period_end: "2026-03-31",
      total_amount: 450
    },
    memberName: "Clara Maddox",
    payor: createPayor(),
    lines: [
      {
        description: "Base program charges",
        service_date: null,
        quantity: 10,
        unit_rate: 45,
        amount: 450
      }
    ],
    generatedAt: "2026-03-17T12:00:00.000Z"
  });

  assert.equal(model.billToName, "Jamie Carter");
  assert.equal(model.billToEmail, "jamie@example.com");
  assert.deepEqual(model.billToAddressLines, ["123 Oak Street", "Fort Mill, SC, 29715"]);
});

test("invoice document model shows explicit missing-payor message instead of fabricating a name", () => {
  const model = buildBillingInvoiceDocumentModel({
    invoice: {
      id: "invoice-1",
      invoice_number: "INV-202603-0001",
      invoice_month: "2026-03-01",
      invoice_status: "Draft",
      member_id: "member-1",
      base_period_start: "2026-03-01",
      base_period_end: "2026-03-31",
      variable_charge_period_start: "2026-03-01",
      variable_charge_period_end: "2026-03-31",
      total_amount: 0
    },
    memberName: "Clara Maddox",
    payor: createPayor({ status: "missing", contact_id: null, full_name: null, email: null, phone: null }),
    lines: [],
    generatedAt: "2026-03-17T12:00:00.000Z"
  });

  assert.equal(model.billToName, "No payor contact designated");
  assert.equal(model.billToMessage, "No payor contact designated");
});

test("billing invoice PDF bytes render a minimal Bill To document", async () => {
  const bytes = await buildBillingInvoicePdfBytes(
    buildBillingInvoiceDocumentModel({
      invoice: {
        id: "invoice-1",
        invoice_number: "INV-202603-0001",
        invoice_month: "2026-03-01",
        invoice_status: "Draft",
        member_id: "member-1",
        base_period_start: "2026-03-01",
        base_period_end: "2026-03-31",
        variable_charge_period_start: "2026-03-01",
        variable_charge_period_end: "2026-03-31",
        total_amount: 450
      },
      memberName: "Clara Maddox",
      payor: createPayor(),
      lines: [
        {
          description: "Base program charges",
          service_date: null,
          quantity: 10,
          unit_rate: 45,
          amount: 450
        }
      ],
      generatedAt: "2026-03-17T12:00:00.000Z"
    })
  );

  const source = readWorkspaceFile("lib/services/billing-invoice-document.ts");
  assert.equal(bytes.byteLength > 0, true);
  assert.equal(bytes.toString("latin1").startsWith("%PDF"), true);
  assert.equal(source.includes('"Bill To"'), true);
  assert.equal(source.includes("No payor contact designated"), true);
});

test("billing canonicalization removes legacy free-text and family-derived payor paths from runtime sources", () => {
  const billingSource = readWorkspaceFile("lib/services/billing-supabase.ts");
  const mccActionSource = readWorkspaceFile("app/(portal)/operations/member-command-center/actions-impl.ts");
  const mhpActionSource = readWorkspaceFile("app/(portal)/health/member-health-profiles/actions-impl.ts");
  const customInvoiceFormSource = readWorkspaceFile("components/forms/billing-custom-invoice-forms.tsx");
  const adjustmentFormSource = readWorkspaceFile("components/forms/billing-manual-adjustment-form.tsx");
  const enrollmentSource = readWorkspaceFile("lib/services/enrollment-packet-intake-mapping.ts");
  const seedSource = readWorkspaceFile("lib/mock/seed.ts");

  assert.equal(billingSource.includes("Self Pay"), false);
  assert.equal(billingSource.includes("Unknown Payor"), false);
  assert.equal(billingSource.includes("row.payor_id ?? row.member_id"), false);
  assert.equal(mccActionSource.includes('mccPatch.payor'), false);
  assert.equal(mhpActionSource.includes('mhpPatch.payor'), false);
  assert.equal(customInvoiceFormSource.includes('name="payorId"'), false);
  assert.equal(adjustmentFormSource.includes('name="payorId"'), false);
  assert.equal(enrollmentSource.includes("p_contacts: []"), true);
  assert.equal(seedSource.includes("${member.display_name} Family"), false);
});

test("billing payor UI and canonical setter wiring remain present in contact management sources", () => {
  const contactManagerSource = readWorkspaceFile("components/forms/member-command-center-contact-manager.tsx");
  const contactServiceSource = readWorkspaceFile("lib/services/member-command-center-supabase.ts");
  const rpcCleanupMigration = readWorkspaceFile("supabase/migrations/0066_billing_payor_sync_cleanup.sql");
  const securityHardeningMigration = readWorkspaceFile("supabase/migrations/0067_billing_payor_security_hardening.sql");

  assert.equal(contactManagerSource.includes("Is Payor"), true);
  assert.equal(contactManagerSource.includes("Bill To"), true);
  assert.equal(contactServiceSource.includes("setBillingPayorContact"), true);
  assert.equal(rpcCleanupMigration.includes("payor = mhp.payor"), false);
  assert.equal(rpcCleanupMigration.includes("payor = mcc.payor"), false);
  assert.equal(securityHardeningMigration.includes("public.current_role() in ('admin', 'manager', 'director', 'nurse', 'coordinator')"), true);
  assert.equal(securityHardeningMigration.includes("create trigger trg_member_contacts_auto_seed_payor"), true);
  assert.equal(
    securityHardeningMigration.includes('create policy "member_contacts_select"\non public.member_contacts\nfor select\nto authenticated\nusing (true);'),
    false
  );
});
