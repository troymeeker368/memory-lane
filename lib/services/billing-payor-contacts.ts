import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { invokeSupabaseRpcOrThrow } from "@/lib/supabase/rpc";
import { resolveCanonicalMemberId } from "@/lib/services/canonical-person-ref";
import {
  buildMemberContactsSchemaOutOfDateMessage,
  buildMemberContactsSchemaOutOfDateError,
  isAmbiguousColumnReferenceError,
  isMemberContactsPayorColumnMissingError,
  MEMBER_CONTACT_PAYOR_MIGRATION
} from "@/lib/services/member-contact-payor-schema";
import {
  recordImmediateSystemAlert,
  recordWorkflowEvent
} from "@/lib/services/workflow-observability";

const SET_MEMBER_CONTACT_PAYOR_RPC = "rpc_set_member_contact_payor";

type BillingPayorContactRow = {
  id: string;
  member_id: string;
  contact_name: string;
  relationship_to_member: string | null;
  email: string | null;
  cellular_number: string | null;
  work_number: string | null;
  home_number: string | null;
  street_address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  is_payor: boolean;
};

export type BillingPayorContactStatus = "ok" | "missing" | "invalid_multiple";

export type BillingPayorContact = {
  status: BillingPayorContactStatus;
  contact_id: string | null;
  member_id: string;
  full_name: string | null;
  relationship_to_member: string | null;
  email: string | null;
  cellular_number: string | null;
  work_number: string | null;
  home_number: string | null;
  phone: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  quickbooks_customer_id: string | null;
  multiple_contact_ids: string[];
};

function clean(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function pickPrimaryPhone(row: Pick<BillingPayorContactRow, "cellular_number" | "work_number" | "home_number">) {
  return clean(row.cellular_number) ?? clean(row.work_number) ?? clean(row.home_number) ?? null;
}

function buildMissingBillingPayorContact(memberId: string): BillingPayorContact {
  return {
    status: "missing",
    contact_id: null,
    member_id: memberId,
    full_name: null,
    relationship_to_member: null,
    email: null,
    cellular_number: null,
    work_number: null,
    home_number: null,
    phone: null,
    address_line_1: null,
    address_line_2: null,
    city: null,
    state: null,
    postal_code: null,
    quickbooks_customer_id: null,
    multiple_contact_ids: []
  };
}

function mapBillingPayorContactRow(row: BillingPayorContactRow): BillingPayorContact {
  return {
    status: "ok",
    contact_id: row.id,
    member_id: row.member_id,
    full_name: clean(row.contact_name),
    relationship_to_member: clean(row.relationship_to_member),
    email: clean(row.email),
    cellular_number: clean(row.cellular_number),
    work_number: clean(row.work_number),
    home_number: clean(row.home_number),
    phone: pickPrimaryPhone(row),
    address_line_1: clean(row.street_address),
    address_line_2: null,
    city: clean(row.city),
    state: clean(row.state),
    postal_code: clean(row.zip),
    quickbooks_customer_id: null,
    multiple_contact_ids: []
  };
}

export function resolveBillingPayorContactRows(memberId: string, rows: BillingPayorContactRow[]): BillingPayorContact {
  const payorRows = rows.filter((row) => row.is_payor === true);
  if (payorRows.length === 0) return buildMissingBillingPayorContact(memberId);
  if (payorRows.length > 1) {
    return {
      ...buildMissingBillingPayorContact(memberId),
      status: "invalid_multiple",
      multiple_contact_ids: payorRows.map((row) => row.id)
    };
  }
  return mapBillingPayorContactRow(payorRows[0]);
}

export function formatBillingPayorDisplayName(payor: BillingPayorContact) {
  if (payor.status !== "ok" || !payor.full_name) return "No payor contact designated";
  return payor.full_name;
}

export function formatBillingPayorAddress(payor: BillingPayorContact) {
  if (payor.status !== "ok") return [];
  return [payor.address_line_1, payor.address_line_2, [payor.city, payor.state, payor.postal_code].filter(Boolean).join(", ")]
    .map((value) => clean(value))
    .filter((value): value is string => Boolean(value));
}

type ResolveBillingMemberOptions = {
  canonicalInput?: boolean;
};

async function resolveBillingMemberId(rawMemberId: string, actionLabel: string, options?: ResolveBillingMemberOptions) {
  if (options?.canonicalInput) return rawMemberId;
  return resolveCanonicalMemberId(rawMemberId, {
    actionLabel,
    serviceRole: true
  });
}

async function recordInvalidMultiplePayorAlert(memberId: string, contactIds: string[], source: string) {
  await recordImmediateSystemAlert({
    entityType: "member",
    entityId: memberId,
    severity: "high",
    alertKey: "billing_payor_multiple_contacts",
    metadata: {
      source,
      contact_ids: contactIds
    }
  });
  await recordWorkflowEvent({
    eventType: "billing_payor_invalid_multiple",
    entityType: "member",
    entityId: memberId,
    actorType: "system",
    status: "invalid_multiple",
    severity: "high",
    metadata: {
      source,
      contact_ids: contactIds
    }
  });
}

export async function listBillingPayorContactsForMembers(
  memberIds: string[],
  options?: ResolveBillingMemberOptions
) {
  const canonicalMemberIds = options?.canonicalInput
    ? Array.from(new Set(memberIds.map((memberId) => clean(memberId)).filter((memberId): memberId is string => Boolean(memberId))))
    : Array.from(
        new Set(
          (
            await Promise.all(
              memberIds
                .map((memberId) => clean(memberId))
                .filter((memberId): memberId is string => Boolean(memberId))
                .map((memberId) => resolveBillingMemberId(memberId, "listBillingPayorContactsForMembers"))
            )
          ).filter(Boolean)
        )
      );
  const results = new Map<string, BillingPayorContact>();
  if (canonicalMemberIds.length === 0) return results;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("member_contacts")
    .select("id, member_id, contact_name, relationship_to_member, email, cellular_number, work_number, home_number, street_address, city, state, zip, is_payor")
    .in("member_id", canonicalMemberIds)
    .eq("is_payor", true)
    .order("updated_at", { ascending: false });
  if (error) {
    throw new Error(
      isMemberContactsPayorColumnMissingError(error)
        ? buildMemberContactsSchemaOutOfDateError().message
        : error.message
    );
  }

  const rows = (data ?? []) as BillingPayorContactRow[];
  for (const memberId of canonicalMemberIds) {
    const payor = resolveBillingPayorContactRows(memberId, rows.filter((row) => row.member_id === memberId));
    if (payor.status === "invalid_multiple") {
      await recordInvalidMultiplePayorAlert(memberId, payor.multiple_contact_ids, "listBillingPayorContactsForMembers");
    }
    results.set(memberId, payor);
  }
  for (const memberId of canonicalMemberIds) {
    if (!results.has(memberId)) {
      results.set(memberId, buildMissingBillingPayorContact(memberId));
    }
  }
  return results;
}

export async function getBillingPayorContact(
  memberId: string,
  options?: { logMissing?: boolean; source?: string; canonicalInput?: boolean }
) {
  const canonicalMemberId = await resolveBillingMemberId(memberId, "getBillingPayorContact", {
    canonicalInput: options?.canonicalInput
  });
  const payor =
    (await listBillingPayorContactsForMembers([canonicalMemberId], { canonicalInput: true })).get(canonicalMemberId) ??
    buildMissingBillingPayorContact(canonicalMemberId);
  if (payor.status === "missing" && options?.logMissing) {
    await recordWorkflowEvent({
      eventType: "billing_payor_missing",
      entityType: "member",
      entityId: canonicalMemberId,
      actorType: "system",
      status: "missing",
      severity: "medium",
      metadata: {
        source: clean(options.source) ?? "getBillingPayorContact"
      }
    });
  }
  return payor;
}

export async function setBillingPayorContact(input: {
  memberId: string;
  contactId: string | null;
  actorUserId?: string | null;
  actorName?: string | null;
  source?: string | null;
  reason?: string | null;
}) {
  const canonicalMemberId = await resolveBillingMemberId(input.memberId, "setBillingPayorContact");
  const admin = createSupabaseAdminClient();
  const contactId = clean(input.contactId);
  try {
    await invokeSupabaseRpcOrThrow<unknown>(admin, SET_MEMBER_CONTACT_PAYOR_RPC, {
      p_member_id: canonicalMemberId,
      p_contact_id: contactId
    });
  } catch (error) {
    const code = error && typeof error === "object" ? String((error as { code?: string }).code ?? "") : "";
    if (code === "PGRST202" || code === "42883") {
      throw new Error(
        `Billing payor contact RPC is unavailable. Apply migration ${MEMBER_CONTACT_PAYOR_MIGRATION} and refresh schema cache.`
      );
    }
    if (
      isAmbiguousColumnReferenceError(
        error as { code?: string | null; message?: string | null; details?: string | null } | null | undefined,
        "member_id"
      )
    ) {
      throw new Error(buildMemberContactsSchemaOutOfDateMessage());
    }
    if (
      isMemberContactsPayorColumnMissingError(
        error as { code?: string | null; message?: string | null; details?: string | null } | null | undefined
      )
    ) {
      throw buildMemberContactsSchemaOutOfDateError();
    }
    if (code === "23505") {
      throw new Error("Only one billing payor contact can be selected for a member.");
    }
    throw error;
  }

  await recordWorkflowEvent({
    eventType: "billing_payor_resolved",
    entityType: "member",
    entityId: canonicalMemberId,
    actorType: clean(input.actorUserId) ? "user" : "system",
    actorUserId: clean(input.actorUserId),
    status: contactId ? "assigned" : "cleared",
    severity: "low",
    metadata: {
      source: clean(input.source) ?? "setBillingPayorContact",
      reason: clean(input.reason),
      contact_id: contactId
    }
  });

  return getBillingPayorContact(canonicalMemberId, {
    logMissing: !contactId,
    source: clean(input.source) ?? "setBillingPayorContact",
    canonicalInput: true
  });
}
