import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import Module from "node:module";
import { join } from "node:path";

function loadEnvFiles() {
  const parseEnvValue = (raw: string) => {
    const trimmed = raw.trim();
    if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  };

  for (const fileName of [".env.local", ".env"]) {
    const fullPath = join(process.cwd(), fileName);
    if (!existsSync(fullPath)) continue;
    const content = readFileSync(fullPath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex <= 0) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = parseEnvValue(trimmed.slice(eqIndex + 1));
      if (!key || process.env[key] !== undefined) continue;
      process.env[key] = value;
    }
  }
}

function installServerOnlyShim() {
  type ModuleLoad = (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
  const moduleShim = Module as typeof Module & { _load: ModuleLoad };
  const originalLoad = moduleShim._load;

  moduleShim._load = function patchedLoad(request: string, parent: NodeModule | null, isMain: boolean) {
    if (
      request === "server-only" ||
      request.endsWith("\\server-only\\index.js") ||
      request.endsWith("/server-only/index.js")
    ) {
      return {};
    }
    return originalLoad.call(this, request, parent, isMain);
  };
}

function clean(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveSupabaseHost() {
  const raw = clean(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL);
  if (!raw) return { host: "", isLocal: false };
  try {
    const host = new URL(raw).host;
    return { host, isLocal: /localhost|127\.0\.0\.1/i.test(host) };
  } catch {
    return { host: raw, isLocal: false };
  }
}

function stableUuid(input: string) {
  const hex = createHash("sha256").update(input).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function parseArgs(argv: string[]) {
  let dryRun = true;
  let apply = false;
  const invoiceNumbers = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      apply = true;
      dryRun = false;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      apply = false;
      continue;
    }
    if (arg === "--invoice-number" && argv[index + 1]) {
      invoiceNumbers.add(argv[index + 1].trim());
      index += 1;
      continue;
    }
    if (arg.startsWith("--invoice-number=")) {
      invoiceNumbers.add(arg.split("=")[1].trim());
    }
  }

  return {
    dryRun,
    apply,
    invoiceNumbers: Array.from(invoiceNumbers).filter(Boolean)
  };
}

type BillingSettingRow = {
  member_id: string;
  payor_id: string | null;
  active: boolean | null;
  effective_start_date: string | null;
  updated_at: string | null;
};

type MemberContactRow = {
  id: string;
  member_id: string;
  contact_name: string | null;
  relationship_to_member: string | null;
  category: string | null;
  email: string | null;
  cellular_number: string | null;
  work_number: string | null;
  home_number: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  is_payor?: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

type PayorRow = {
  id: string;
  payor_name: string | null;
  quickbooks_customer_name: string | null;
};

type BillingInvoiceRow = {
  id: string;
  invoice_number: string;
  member_id: string;
  payor_id: string | null;
  bill_to_name_snapshot: string | null;
};

type PayorRepairCandidate = {
  payorId: string;
  memberId: string;
  quickbooksCustomerName: string;
  billToAddressLine1: string | null;
  billToAddressLine2: string | null;
  billToAddressLine3: string | null;
  billToEmail: string | null;
  billToPhone: string | null;
};

type PayorRepairSkip = {
  payorId: string;
  memberId?: string;
  reason: string;
};

function compareSettings(left: BillingSettingRow, right: BillingSettingRow) {
  return (
    Number(Boolean(right.active)) - Number(Boolean(left.active)) ||
    String(right.effective_start_date ?? "").localeCompare(String(left.effective_start_date ?? "")) ||
    String(right.updated_at ?? "").localeCompare(String(left.updated_at ?? ""))
  );
}

function compareContacts(left: MemberContactRow, right: MemberContactRow) {
  return String(right.updated_at ?? "").localeCompare(String(left.updated_at ?? ""));
}

function contactPriority(row: MemberContactRow) {
  const relationship = clean(row.relationship_to_member)?.toLowerCase() ?? "";
  const category = clean(row.category)?.toLowerCase() ?? "";
  if (relationship === "spouse" || relationship === "wife" || relationship === "husband") return 0;
  if (relationship === "daughter" || relationship === "son") return 1;
  if (relationship === "mother" || relationship === "father") return 2;
  if (category.includes("emergency")) return 3;
  if (category.includes("child")) return 4;
  if (relationship.includes("care")) return 8;
  if (category.includes("care")) return 9;
  return 5;
}

function compareFallbackContacts(left: MemberContactRow, right: MemberContactRow) {
  return (
    contactPriority(left) - contactPriority(right) ||
    String(left.created_at ?? "").localeCompare(String(right.created_at ?? "")) ||
    String(left.id).localeCompare(String(right.id))
  );
}

function looksSeedGeneratedContact(row: MemberContactRow) {
  const email = clean(row.email);
  return !email || email.endsWith("@example.org") || email.endsWith("@example.com");
}

function buildPayorRepairCandidate(input: {
  payor: PayorRow;
  settings: BillingSettingRow[];
  payorContactsByMemberId: Map<string, MemberContactRow[]>;
}): PayorRepairCandidate | PayorRepairSkip | null {
  if (clean(input.payor.quickbooks_customer_name)) return null;

  const primarySetting = [...input.settings].sort(compareSettings)[0] ?? null;
  if (!primarySetting?.payor_id || !primarySetting.member_id) {
    return {
      payorId: input.payor.id,
      reason: "No member billing setting points to this payor."
    } as const;
  }

  const payorContacts = [...(input.payorContactsByMemberId.get(primarySetting.member_id) ?? [])].sort(compareContacts);
  if (payorContacts.length === 0) {
    return {
      payorId: input.payor.id,
      memberId: primarySetting.member_id,
      reason: "No canonical payor contact is flagged for the linked member."
    } as const;
  }
  if (payorContacts.length > 1) {
    return {
      payorId: input.payor.id,
      memberId: primarySetting.member_id,
      reason: "Multiple canonical payor contacts are flagged for the linked member."
    } as const;
  }

  const payorContact = payorContacts[0];
  const quickbooksCustomerName = clean(payorContact.contact_name);
  if (!quickbooksCustomerName) {
    return {
      payorId: input.payor.id,
      memberId: primarySetting.member_id,
      reason: "The canonical payor contact does not have a usable contact name."
    } as const;
  }

  const cityStatePostal = [clean(payorContact.city), clean(payorContact.state), clean(payorContact.zip)]
    .filter((value): value is string => Boolean(value))
    .join(", ");

  return {
    payorId: input.payor.id,
    memberId: primarySetting.member_id,
    quickbooksCustomerName,
    billToAddressLine1: clean(payorContact.street_address),
    billToAddressLine2: null,
    billToAddressLine3: clean(cityStatePostal),
    billToEmail: clean(payorContact.email),
    billToPhone: clean(payorContact.cellular_number) ?? clean(payorContact.work_number) ?? clean(payorContact.home_number)
  } satisfies PayorRepairCandidate;
}

function buildSeededFallbackPayorCandidate(memberId: string, contacts: MemberContactRow[]): PayorRepairCandidate | PayorRepairSkip | null {
  const seededContacts = contacts.filter(looksSeedGeneratedContact);
  if (seededContacts.length === 0 || seededContacts.length !== contacts.length) {
    return {
      payorId: stableUuid(`billing-payor-repair:${memberId}`),
      memberId,
      reason: "Missing payor linkage could not be repaired automatically because the member contacts do not look seed-generated."
    };
  }

  const primaryContact = [...seededContacts].sort(compareFallbackContacts)[0] ?? null;
  if (!primaryContact) {
    return {
      payorId: stableUuid(`billing-payor-repair:${memberId}`),
      memberId,
      reason: "Missing payor linkage could not be repaired automatically because no member contact was available."
    };
  }

  const quickbooksCustomerName = clean(primaryContact.contact_name);
  if (!quickbooksCustomerName) {
    return {
      payorId: stableUuid(`billing-payor-repair:${memberId}`),
      memberId,
      reason: "Missing payor linkage could not be repaired automatically because the selected contact has no usable name."
    };
  }

  const cityStatePostal = [clean(primaryContact.city), clean(primaryContact.state), clean(primaryContact.zip)]
    .filter((value): value is string => Boolean(value))
    .join(", ");

  return {
    payorId: stableUuid(`billing-payor-repair:${memberId}`),
    memberId,
    quickbooksCustomerName,
    billToAddressLine1: clean(primaryContact.street_address),
    billToAddressLine2: null,
    billToAddressLine3: clean(cityStatePostal),
    billToEmail: clean(primaryContact.email),
    billToPhone: clean(primaryContact.cellular_number) ?? clean(primaryContact.work_number) ?? clean(primaryContact.home_number)
  };
}

function isPayorRepairSkip(candidate: PayorRepairCandidate | PayorRepairSkip): candidate is PayorRepairSkip {
  return "reason" in candidate;
}

async function main() {
  loadEnvFiles();
  installServerOnlyShim();
  const args = parseArgs(process.argv.slice(2));
  const target = resolveSupabaseHost();

  if (args.apply && !target.isLocal && process.env.ALLOW_REMOTE_BILLING_QUICKBOOKS_BACKFILL !== "true") {
    throw new Error(
      `Refusing live billing QuickBooks backfill against remote Supabase host ${target.host}. Set ALLOW_REMOTE_BILLING_QUICKBOOKS_BACKFILL=true to override.`
    );
  }

  const { createSupabaseAdminClient } = await import("../lib/supabase/admin");
  const admin = createSupabaseAdminClient();
  const invoiceScopedQuery =
    args.invoiceNumbers.length > 0
      ? admin
          .from("billing_invoices")
          .select("id, invoice_number, member_id, payor_id, bill_to_name_snapshot")
          .in("invoice_number", args.invoiceNumbers)
      : admin
          .from("billing_invoices")
          .select("id, invoice_number, member_id, payor_id, bill_to_name_snapshot")
          .or("payor_id.is.null,bill_to_name_snapshot.is.null,bill_to_name_snapshot.eq.,bill_to_name_snapshot.eq.No payor contact designated");

  const { data: invoiceData, error: invoiceError } = await invoiceScopedQuery;
  if (invoiceError) throw new Error(`Unable to load billing invoices for repair: ${invoiceError.message}`);

  const scopedInvoices = (invoiceData ?? []) as BillingInvoiceRow[];
  const memberIds = Array.from(new Set(scopedInvoices.map((row) => clean(row.member_id)).filter((value): value is string => Boolean(value))));
  if (memberIds.length === 0) {
    console.log(
      JSON.stringify(
        {
          dryRun: args.dryRun,
          targetHost: target.host,
          invoicesScanned: scopedInvoices.length,
          payorsUpdated: 0,
          invoicesUpdated: 0,
          skipped: []
        },
        null,
        2
      )
    );
    return;
  }

  const { data: settingsData, error: settingsError } = await admin
    .from("member_billing_settings")
    .select("member_id, payor_id, active, effective_start_date, updated_at")
    .in("member_id", memberIds);
  if (settingsError) throw new Error(`Unable to load billing settings for repair: ${settingsError.message}`);

  const settingsRows = (settingsData ?? []) as BillingSettingRow[];
  const resolvedPayorIds = Array.from(
    new Set(
      [
        ...scopedInvoices.map((row) => clean(row.payor_id)),
        ...settingsRows.map((row) => clean(row.payor_id))
      ].filter((value): value is string => Boolean(value))
    )
  );
  const { data: payorData, error: payorError } =
    resolvedPayorIds.length > 0
      ? await admin
          .from("payors")
          .select("id, payor_name, quickbooks_customer_name")
          .in("id", resolvedPayorIds)
      : { data: [], error: null };
  if (payorError) throw new Error(`Unable to load payors for repair: ${payorError.message}`);

  const { data: contactData, error: contactError } =
    memberIds.length > 0
      ? await admin
          .from("member_contacts")
          .select("id, member_id, contact_name, relationship_to_member, category, email, cellular_number, work_number, home_number, street_address, city, state, zip, is_payor, created_at, updated_at")
          .in("member_id", memberIds)
      : { data: [], error: null };
  if (contactError) throw new Error(`Unable to load canonical payor contacts for repair: ${contactError.message}`);

  const payorRows = (payorData ?? []) as PayorRow[];
  const settingsByPayorId = new Map<string, BillingSettingRow[]>();
  const settingsByMemberId = new Map<string, BillingSettingRow[]>();
  settingsRows.forEach((row) => {
    const payorId = clean(row.payor_id);
    if (!payorId) return;
    const existing = settingsByPayorId.get(payorId);
    if (existing) {
      existing.push(row);
      return;
    }
    settingsByPayorId.set(payorId, [row]);
  });
  settingsRows.forEach((row) => {
    const memberId = clean(row.member_id);
    if (!memberId) return;
    const existing = settingsByMemberId.get(memberId);
    if (existing) {
      existing.push(row);
      return;
    }
    settingsByMemberId.set(memberId, [row]);
  });

  const contactRows = (contactData ?? []) as MemberContactRow[];
  const payorContactsByMemberId = new Map<string, MemberContactRow[]>();
  const allContactsByMemberId = new Map<string, MemberContactRow[]>();
  contactRows.forEach((row) => {
    const allExisting = allContactsByMemberId.get(row.member_id);
    if (allExisting) {
      allExisting.push(row);
    } else {
      allContactsByMemberId.set(row.member_id, [row]);
    }
    if (row.is_payor !== true) return;
    const existing = payorContactsByMemberId.get(row.member_id);
    if (existing) {
      existing.push(row);
      return;
    }
    payorContactsByMemberId.set(row.member_id, [row]);
  });

  const skipped: PayorRepairSkip[] = [];
  const payorRepairs = new Map<string, PayorRepairCandidate>();
  const payorCandidates = new Map<string, PayorRepairCandidate>();
  payorRows.forEach((payor) => {
    const candidate = buildPayorRepairCandidate({
      payor,
      settings: settingsByPayorId.get(payor.id) ?? [],
      payorContactsByMemberId
    });
    if (!candidate) return;
    if (isPayorRepairSkip(candidate)) {
      skipped.push(candidate);
      return;
    }
    payorCandidates.set(candidate.payorId, candidate);
    if (clean(payor.quickbooks_customer_name)) return;
    payorRepairs.set(candidate.payorId, candidate);
  });

  const fallbackPayorCandidatesByMemberId = new Map<string, PayorRepairCandidate>();
  memberIds.forEach((memberId) => {
    const activeSettings = [...(settingsByMemberId.get(memberId) ?? [])].sort(compareSettings);
    const resolvedPayorId = clean(activeSettings[0]?.payor_id);
    if (resolvedPayorId && payorCandidates.has(resolvedPayorId)) return;
    const fallbackCandidate = buildSeededFallbackPayorCandidate(memberId, allContactsByMemberId.get(memberId) ?? []);
    if (!fallbackCandidate) return;
    if (isPayorRepairSkip(fallbackCandidate)) {
      skipped.push(fallbackCandidate);
      return;
    }
    fallbackPayorCandidatesByMemberId.set(memberId, fallbackCandidate);
  });

  const invoiceRepairs = scopedInvoices
    .map((invoice) => {
      const memberSettings = [...(settingsByMemberId.get(invoice.member_id) ?? [])].sort(compareSettings);
      const resolvedPayorId = clean(invoice.payor_id) ?? clean(memberSettings[0]?.payor_id);
      const payorCandidate =
        (resolvedPayorId ? payorCandidates.get(resolvedPayorId) ?? null : null) ?? fallbackPayorCandidatesByMemberId.get(invoice.member_id) ?? null;
      const needsSnapshotRepair = !clean(invoice.bill_to_name_snapshot);
      const needsPayorRepair = !clean(invoice.payor_id) && Boolean(resolvedPayorId);
      const needsFallbackPayorRepair = !clean(invoice.payor_id) && Boolean(payorCandidate);
      if (!payorCandidate || (!needsSnapshotRepair && !needsPayorRepair && !needsFallbackPayorRepair)) return null;
      return {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoice_number,
        memberId: invoice.member_id,
        payorId: resolvedPayorId ?? payorCandidate.payorId,
        bill_to_name_snapshot: payorCandidate.quickbooksCustomerName,
        bill_to_address_line_1_snapshot: payorCandidate.billToAddressLine1,
        bill_to_address_line_2_snapshot: payorCandidate.billToAddressLine2,
        bill_to_address_line_3_snapshot: payorCandidate.billToAddressLine3,
        bill_to_email_snapshot: payorCandidate.billToEmail,
        bill_to_phone_snapshot: payorCandidate.billToPhone,
        bill_to_message_snapshot: null
      };
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

  const fallbackCandidates = Array.from(fallbackPayorCandidatesByMemberId.values()).filter((candidate) =>
    invoiceRepairs.some((invoice) => invoice.memberId === candidate.memberId)
  );

  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          targetHost: target.host,
          invoicesScanned: scopedInvoices.length,
          payorsReadyToUpdate: payorRepairs.size,
          fallbackPayorsReadyToCreate: fallbackCandidates.length,
          invoicesReadyToUpdate: invoiceRepairs.length,
          payorSamples: Array.from(payorRepairs.values()).slice(0, 10),
          fallbackPayorSamples: fallbackCandidates.slice(0, 10),
          invoiceSamples: invoiceRepairs.slice(0, 10),
          skipped: skipped.slice(0, 20)
        },
        null,
        2
      )
    );
    return;
  }

  let payorsUpdated = 0;
  for (const repair of payorRepairs.values()) {
    const { error } = await admin
      .from("payors")
      .update({
        quickbooks_customer_name: repair.quickbooksCustomerName
      })
      .eq("id", repair.payorId);
    if (error) throw new Error(`Unable to update payor ${repair.payorId}: ${error.message}`);
    payorsUpdated += 1;
  }

  for (const repair of fallbackCandidates) {
    const memberContacts = [...(allContactsByMemberId.get(repair.memberId) ?? [])].sort(compareFallbackContacts);
    const primaryContact = memberContacts[0] ?? null;
    if (!primaryContact) throw new Error(`Unable to create fallback payor for member ${repair.memberId}: no contact rows available.`);

    const payorInsert = await admin.from("payors").upsert(
      {
        id: repair.payorId,
        payor_name: repair.quickbooksCustomerName,
        payor_type: "Private",
        billing_contact_name: repair.quickbooksCustomerName,
        billing_email: repair.billToEmail,
        billing_phone: repair.billToPhone,
        billing_method: "InvoiceEmail",
        auto_draft_enabled: false,
        quickbooks_customer_name: repair.quickbooksCustomerName,
        quickbooks_customer_ref: null,
        status: "active",
        notes: "Backfilled from a seed-generated member contact because canonical payor linkage was missing.",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        updated_by_user_id: null,
        updated_by_name: "Billing QuickBooks repair"
      },
      { onConflict: "id" }
    );
    if (payorInsert.error) {
      throw new Error(`Unable to create fallback payor ${repair.payorId} for member ${repair.memberId}: ${payorInsert.error.message}`);
    }

    const contactUpdate = await admin.from("member_contacts").update({ is_payor: true }).eq("id", primaryContact.id);
    if (contactUpdate.error) {
      throw new Error(`Unable to mark contact ${primaryContact.id} as payor: ${contactUpdate.error.message}`);
    }

    const settingUpdate = await admin
      .from("member_billing_settings")
      .update({ payor_id: repair.payorId, updated_at: new Date().toISOString() })
      .eq("member_id", repair.memberId)
      .is("payor_id", null);
    if (settingUpdate.error) {
      throw new Error(`Unable to attach fallback payor ${repair.payorId} to member billing settings for member ${repair.memberId}: ${settingUpdate.error.message}`);
    }

    payorsUpdated += 1;
  }

  let invoicesUpdated = 0;
  for (const repair of invoiceRepairs) {
    const { error } = await admin
      .from("billing_invoices")
      .update({
        payor_id: repair.payorId,
        bill_to_name_snapshot: repair.bill_to_name_snapshot,
        bill_to_address_line_1_snapshot: repair.bill_to_address_line_1_snapshot,
        bill_to_address_line_2_snapshot: repair.bill_to_address_line_2_snapshot,
        bill_to_address_line_3_snapshot: repair.bill_to_address_line_3_snapshot,
        bill_to_email_snapshot: repair.bill_to_email_snapshot,
        bill_to_phone_snapshot: repair.bill_to_phone_snapshot,
        bill_to_message_snapshot: repair.bill_to_message_snapshot
      })
      .eq("id", repair.invoiceId);
    if (error) throw new Error(`Unable to update invoice ${repair.invoiceNumber}: ${error.message}`);
    invoicesUpdated += 1;
  }

  console.log(
    JSON.stringify(
      {
        dryRun: false,
        targetHost: target.host,
        invoicesScanned: scopedInvoices.length,
        payorsUpdated,
        invoicesUpdated,
        skipped
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
