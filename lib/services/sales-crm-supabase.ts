import { randomUUID } from "node:crypto";

import { normalizePhoneForStorage } from "@/lib/phone";
import { insertAuditLogEntry } from "@/lib/services/audit-log-service";
import { buildIdempotencyHash, isPostgresUniqueViolation } from "@/lib/services/idempotency";
import {
  getSalesPartnerByIdOrCodeSupabase,
  resolveSalesPartnerAndReferralSupabase,
  type SalesPartnerRow
} from "@/lib/services/sales-crm-read-model";
import { createClient } from "@/lib/supabase/server";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

function clean(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function makeShortCode(prefix: string) {
  const token = randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  return `${prefix}-${token}`;
}

export async function createSalesLeadSupabase(input: {
  leadPatch: Record<string, unknown>;
  createdByUserId: string;
}) {
  const { stage_updated_at: _ignoredStageUpdatedAt, updated_at: _ignoredUpdatedAt, ...stableLeadPatch } = input.leadPatch;
  const idempotencyKey = buildIdempotencyHash("sales-lead:create", {
    createdByUserId: input.createdByUserId,
    leadPatch: stableLeadPatch
  });
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .insert({
      ...input.leadPatch,
      created_by_user_id: input.createdByUserId,
      idempotency_key: idempotencyKey
    })
    .select("id")
    .single();
  if (!error && data?.id) {
    return { id: String(data.id), idempotencyKey, duplicateSafe: false };
  }

  if (isPostgresUniqueViolation(error)) {
    const { data: existing, error: existingError } = await supabase
      .from("leads")
      .select("id")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (existing?.id) {
      return { id: String(existing.id), idempotencyKey, duplicateSafe: true };
    }
  }

  throw new Error(error?.message ?? "Unable to create lead.");
}

export async function insertSalesAuditLogSupabase(input: {
  actorUserId: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  details?: Record<string, unknown>;
  dedupeKey?: string | null;
}) {
  await insertAuditLogEntry({
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    details: input.details ?? {},
    dedupeKey: input.dedupeKey ?? null
  });
}

export async function createPartnerActivitySupabase(input: {
  partnerId: string;
  referralSourceId: string;
  activityAt?: string | null;
  activityType: string;
  notes?: string | null;
  nextFollowUpDate?: string | null;
  nextFollowUpType?: string | null;
  completedByName: string;
}) {
  const { partner, referralSource } = await resolveSalesPartnerAndReferralSupabase({
    partnerId: input.partnerId,
    referralSourceId: input.referralSourceId
  });
  if (!partner) throw new Error("Community partner organization not found.");
  if (!referralSource) throw new Error("Referral source not found.");

  const nowDate = toEasternDate();
  const supabase = await createClient();
  const { error: insertError } = await supabase.from("partner_activities").insert({
    referral_source_id: referralSource.id,
    partner_id: partner.id,
    organization_name: partner.organization_name,
    contact_name: referralSource.contact_name,
    activity_at: clean(input.activityAt) ?? toEasternISO(),
    activity_type: input.activityType,
    notes: clean(input.notes),
    completed_by_name: input.completedByName,
    next_follow_up_date: clean(input.nextFollowUpDate),
    next_follow_up_type: clean(input.nextFollowUpType),
    last_touched: nowDate
  });
  if (insertError) throw new Error(insertError.message);

  await Promise.all([
    supabase.from("community_partner_organizations").update({ last_touched: nowDate }).eq("id", partner.id),
    supabase.from("referral_sources").update({ last_touched: nowDate }).eq("id", referralSource.id)
  ]);

  return {
    partner,
    referralSource
  };
}

export async function createCommunityPartnerSupabase(input: {
  organizationName: string;
  referralSourceCategory: string;
  location?: string | null;
  primaryPhone?: string | null;
  secondaryPhone?: string | null;
  primaryEmail?: string | null;
  notes?: string | null;
  active: boolean;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("community_partner_organizations")
    .insert({
      partner_id: makeShortCode("P"),
      organization_name: input.organizationName.trim(),
      category: input.referralSourceCategory.trim(),
      location: clean(input.location),
      primary_phone: normalizePhoneForStorage(input.primaryPhone ?? null),
      secondary_phone: normalizePhoneForStorage(input.secondaryPhone ?? null),
      primary_email: clean(input.primaryEmail),
      active: input.active,
      notes: clean(input.notes),
      last_touched: null
    })
    .select("id, partner_id, organization_name")
    .single();
  if (error) throw new Error(error.message);
  return {
    id: String(data.id),
    partner: {
      id: String(data.id),
      partner_id: String(data.partner_id),
      organization_name: String(data.organization_name)
    }
  };
}

export async function createReferralSourceSupabase(input: {
  partnerId: string;
  contactName: string;
  jobTitle?: string | null;
  primaryPhone?: string | null;
  secondaryPhone?: string | null;
  primaryEmail?: string | null;
  preferredContactMethod?: string | null;
  notes?: string | null;
  active: boolean;
}) {
  const partner = await getSalesPartnerByIdOrCodeSupabase(input.partnerId);
  if (!partner) throw new Error("Select a valid organization first.");

  const sourceCode = makeShortCode("RS");
  const nowDate = toEasternDate();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("referral_sources")
    .insert({
      referral_source_id: sourceCode,
      partner_id: partner.id,
      contact_name: input.contactName.trim(),
      organization_name: partner.organization_name,
      job_title: clean(input.jobTitle),
      primary_phone: normalizePhoneForStorage(input.primaryPhone ?? null),
      secondary_phone: normalizePhoneForStorage(input.secondaryPhone ?? null),
      primary_email: clean(input.primaryEmail),
      preferred_contact_method: clean(input.preferredContactMethod),
      active: input.active,
      notes: clean(input.notes),
      last_touched: nowDate
    })
    .select("id, referral_source_id, partner_id, contact_name, organization_name")
    .single();
  if (error) throw new Error(error.message);

  await supabase
    .from("community_partner_organizations")
    .update({ last_touched: nowDate })
    .eq("id", partner.id);

  return {
    id: String(data.id),
    source: {
      id: String(data.id),
      referral_source_id: String(data.referral_source_id),
      partner_id: String((partner as SalesPartnerRow).partner_id ?? data.partner_id),
      contact_name: String(data.contact_name),
      organization_name: String(data.organization_name ?? "")
    }
  };
}
