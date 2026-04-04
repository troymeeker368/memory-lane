import "server-only";

import { createClient } from "@/lib/supabase/server";
import { assertCanonicalMemberResolverInput } from "@/lib/services/canonical-member-ref-input";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { toEasternDate } from "@/lib/timezone";
import type {
  CanonicalExpectedIdentity,
  CanonicalMemberRefInput,
  CanonicalPersonRef,
  CanonicalPersonRefInput,
  CanonicalPersonSourceType
} from "@/types/identity";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type LeadIdentityRow = {
  id: string;
  member_name: string | null;
  stage: string | null;
  status: string | null;
};

type MemberIdentityRow = {
  id: string;
  display_name: string | null;
  status: "active" | "inactive" | null;
  enrollment_date?: string | null;
  dob?: string | null;
  source_lead_id: string | null;
};

export type CanonicalMemberLink = {
  leadId: string;
  memberId: string;
  displayName: string;
  memberStatus: "active" | "inactive" | null;
};

function clean(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function asUuid(value: string | null | undefined) {
  const normalized = clean(value);
  if (!normalized) return null;
  return UUID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeSourceType(value: string | null | undefined): CanonicalPersonSourceType | null {
  const normalized = clean(value)?.toLowerCase();
  if (normalized === "lead" || normalized === "member") return normalized;
  return null;
}

function isCanonicalDebugEnabled() {
  const raw = String(process.env.CANONICAL_PERSON_REF_DEBUG ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function debugCanonicalIdentity(event: string, payload: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  if (!isCanonicalDebugEnabled()) return;
  console.info(`[canonical-person-ref] ${event}`, payload);
}

function duplicateLeadLinkError(actionLabel: string, leadId: string, memberIds: string[]) {
  const normalizedIds = memberIds.filter(Boolean).join(", ");
  return new Error(
    `${actionLabel} found multiple members linked to lead ${leadId}. Clean duplicate members.source_lead_id rows before continuing. Conflicting member ids: ${normalizedIds}.`
  );
}

function buildIdentityErrorMessage(input: {
  expectedType: Exclude<CanonicalExpectedIdentity, "any">;
  actionLabel: string;
  incomingSourceType: CanonicalPersonSourceType | null;
  candidateLeadId: string | null;
  candidateMemberId: string | null;
  selectedId: string | null;
  externalId: string | null;
  legacyId: string | null;
  resolutionHint?: string | null;
}) {
  const expectedLabel = input.expectedType === "member" ? "member.id" : "lead.id";
  const sourceLabel = input.incomingSourceType ?? "unknown";
  const supplied = [
    `sourceType=${sourceLabel}`,
    `selectedId=${input.selectedId ?? "none"}`,
    `memberId=${input.candidateMemberId ?? "none"}`,
    `leadId=${input.candidateLeadId ?? "none"}`,
    `externalId=${input.externalId ?? "none"}`,
    `legacyId=${input.legacyId ?? "none"}`
  ].join(", ");
  const hint = clean(input.resolutionHint);
  return `${input.actionLabel} expected ${expectedLabel}, but payload did not resolve to a canonical ${expectedLabel}.${hint ? ` ${hint}` : ""} Received: ${supplied}.`;
}

function toCanonicalPersonRef(input: {
  requestedSourceType: CanonicalPersonSourceType | null;
  member: MemberIdentityRow | null;
  lead: LeadIdentityRow | null;
  fallbackDisplayName: string | null;
}): CanonicalPersonRef {
  const member = input.member;
  const lead = input.lead;
  const sourceType: CanonicalPersonSourceType =
    input.requestedSourceType ??
    (member ? "member" : "lead");
  const memberStatus = member?.status ?? null;
  const enrollmentStatus = member
    ? memberStatus === "active"
      ? "enrolled-active"
      : "enrolled-inactive"
    : "not-enrolled";
  const safeWorkflowType = member && lead ? "hybrid" : member ? "member-only" : "lead-only";
  return {
    sourceType,
    leadId: lead?.id ?? member?.source_lead_id ?? null,
    memberId: member?.id ?? null,
    displayName: member?.display_name ?? lead?.member_name ?? input.fallbackDisplayName ?? "Unknown Person",
    memberStatus,
    leadStage: lead?.stage ?? null,
    leadStatus: lead?.status ?? null,
    enrollmentStatus,
    safeWorkflowType
  };
}

async function getCanonicalIdentityClient(serviceRole = false) {
  if (serviceRole) {
    return createServiceRoleClient("canonical_identity_resolution_read");
  }
  return createClient();
}

async function getMemberById(memberId: string, serviceRole = false) {
  const supabase = await getCanonicalIdentityClient(serviceRole);
  const { data, error } = await supabase
    .from("members")
    .select("id, display_name, status, source_lead_id")
    .eq("id", memberId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MemberIdentityRow | null) ?? null;
}

async function getLeadById(leadId: string, serviceRole = false) {
  const supabase = await getCanonicalIdentityClient(serviceRole);
  const { data, error } = await supabase
    .from("leads")
    .select("id, member_name, stage, status")
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as LeadIdentityRow | null) ?? null;
}

async function getMemberByLeadId(leadId: string, serviceRole = false) {
  const supabase = await getCanonicalIdentityClient(serviceRole);
  const { data, error } = await supabase
    .from("members")
    .select("id, display_name, status, enrollment_date, dob, source_lead_id")
    .eq("source_lead_id", leadId)
    .limit(2);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as MemberIdentityRow[];
  if (rows.length > 1) {
    throw duplicateLeadLinkError("getMemberByLeadId", leadId, rows.map((row) => row.id));
  }
  return rows[0] ?? null;
}

export async function ensureCanonicalMemberForLead(
  input: {
    leadId: string;
    actionLabel?: string;
    serviceRole?: boolean;
  }
) {
  const actionLabel = clean(input.actionLabel) ?? "ensureCanonicalMemberForLead";
  const canonicalLead = await resolveCanonicalLeadRef(
    {
      sourceType: "lead",
      leadId: input.leadId,
      selectedId: input.leadId
    },
    {
      actionLabel,
      serviceRole: input.serviceRole
    }
  );
  if (!canonicalLead.leadId) {
    throw new Error(`${actionLabel} expected lead.id but canonical lead resolution returned empty leadId.`);
  }

  const serviceRole = Boolean(input.serviceRole);
  const supabase = await getCanonicalIdentityClient(serviceRole);
  const existingMember = await getMemberByLeadId(canonicalLead.leadId, serviceRole);
  const { data: leadRow, error: leadError } = await supabase
    .from("leads")
    .select("id, member_name, member_dob, member_start_date")
    .eq("id", canonicalLead.leadId)
    .maybeSingle();
  if (leadError) throw new Error(`${actionLabel} failed to load lead: ${leadError.message}`);
  if (!leadRow) throw new Error(`${actionLabel} could not find lead.id ${canonicalLead.leadId}.`);

  const displayName = clean(String(leadRow.member_name ?? "")) ?? canonicalLead.displayName ?? "Unknown Member";
  const dob = clean(String(leadRow.member_dob ?? "")) ?? null;
  const enrollmentDate = clean(String(leadRow.member_start_date ?? "")) ?? toEasternDate();

  if (existingMember) {
    const patch: Record<string, unknown> = {
      display_name: displayName,
      source_lead_id: canonicalLead.leadId
    };
    if (!clean(existingMember.enrollment_date)) patch.enrollment_date = enrollmentDate;
    if (dob && !clean(existingMember.dob)) patch.dob = dob;
    const { error: updateError } = await supabase.from("members").update(patch).eq("id", existingMember.id);
    if (updateError) throw new Error(`${actionLabel} failed to update linked member: ${updateError.message}`);
    const refreshed = await getMemberById(existingMember.id, serviceRole);
    if (!refreshed) throw new Error(`${actionLabel} linked member disappeared after update.`);
    return refreshed;
  }

  const { data: inserted, error: insertError } = await supabase
    .from("members")
    .insert({
      display_name: displayName,
      status: "inactive",
      enrollment_date: enrollmentDate,
      dob,
      source_lead_id: canonicalLead.leadId
    })
    .select("id, display_name, status, enrollment_date, dob, source_lead_id")
    .single();
  if (insertError) {
    throw new Error(`${actionLabel} failed to create canonical member from lead: ${insertError.message}`);
  }
  return inserted as MemberIdentityRow;
}

export async function listCanonicalMemberLinksForLeadIds(
  leadIds: string[],
  options?: { actionLabel?: string; serviceRole?: boolean }
) {
  const actionLabel = clean(options?.actionLabel) ?? "listCanonicalMemberLinksForLeadIds";
  const normalizedLeadIds = [...new Set(leadIds.map((leadId) => asUuid(leadId)).filter((leadId): leadId is string => Boolean(leadId)))];
  if (normalizedLeadIds.length === 0) {
    return new Map<string, CanonicalMemberLink>();
  }

  const supabase = await getCanonicalIdentityClient(Boolean(options?.serviceRole));
  const { data, error } = await supabase
    .from("members")
    .select("id, display_name, status, source_lead_id")
    .in("source_lead_id", normalizedLeadIds);
  if (error) {
    throw new Error(`${actionLabel} failed to load canonical lead/member links: ${error.message}`);
  }

  const links = new Map<string, CanonicalMemberLink>();
  for (const row of (data ?? []) as MemberIdentityRow[]) {
    const leadId = asUuid(row.source_lead_id);
    if (!leadId) continue;
    if (links.has(leadId)) {
      throw duplicateLeadLinkError(actionLabel, leadId, [links.get(leadId)?.memberId ?? "", row.id]);
    }
    links.set(leadId, {
      leadId,
      memberId: row.id,
      displayName: clean(row.display_name) ?? "Unknown Person",
      memberStatus: row.status ?? null
    });
  }

  return links;
}

export async function resolveCanonicalPersonRef(
  input: CanonicalPersonRefInput,
  options?: {
    expectedType?: CanonicalExpectedIdentity;
    actionLabel?: string;
    serviceRole?: boolean;
  }
) {
  const expectedType = options?.expectedType ?? "any";
  const actionLabel = clean(options?.actionLabel) ?? "identity resolution";
  const requestedSourceType = normalizeSourceType(input.sourceType);
  const selectedId = asUuid(input.selectedId);
  const explicitLeadId = asUuid(input.leadId);
  const explicitMemberId = asUuid(input.memberId);
  const externalId = asUuid(input.externalId);
  const legacyId = asUuid(input.legacyId);
  const fallbackCandidate = selectedId ?? externalId ?? legacyId;

  let candidateMemberId = explicitMemberId;
  let candidateLeadId = explicitLeadId;

  if (!candidateMemberId && requestedSourceType === "member") candidateMemberId = fallbackCandidate;
  if (!candidateLeadId && requestedSourceType === "lead") candidateLeadId = fallbackCandidate;

  if (!candidateMemberId && !candidateLeadId && fallbackCandidate) {
    if (!requestedSourceType) {
      throw new Error(
        `${actionLabel} requires explicit sourceType ("member" or "lead") when only selectedId/externalId/legacyId is provided.`
      );
    }
    if (requestedSourceType === "member") {
      candidateMemberId = fallbackCandidate;
    } else {
      candidateLeadId = fallbackCandidate;
    }
  }

  debugCanonicalIdentity("incoming", {
    actionLabel,
    expectedType,
    sourceType: requestedSourceType ?? "unknown",
    selectedId: selectedId ?? "",
    memberId: candidateMemberId ?? "",
    leadId: candidateLeadId ?? "",
    externalId: externalId ?? "",
    legacyId: legacyId ?? ""
  });

  const serviceRole = Boolean(options?.serviceRole);
  const [memberFromId, leadFromId] = await Promise.all([
    candidateMemberId ? getMemberById(candidateMemberId, serviceRole) : Promise.resolve(null),
    candidateLeadId ? getLeadById(candidateLeadId, serviceRole) : Promise.resolve(null)
  ]);

  let member = memberFromId;
  let lead = leadFromId;

  if (member?.source_lead_id && !lead) {
    lead = await getLeadById(member.source_lead_id, serviceRole);
  }

  if (lead && !member) {
    member = await getMemberByLeadId(lead.id, serviceRole);
  }

  if (member && lead) {
    const linkedLeadId = asUuid(member.source_lead_id);
    if (!linkedLeadId) {
      throw new Error(
        `${actionLabel} received both member.id and lead.id, but member.id ${member.id} is not canonically linked to any lead.`
      );
    }
    if (linkedLeadId !== lead.id) {
      throw new Error(
        `${actionLabel} received conflicting identities: member.id ${member.id} is linked to lead.id ${linkedLeadId}, but lead.id ${lead.id} was supplied.`
      );
    }
  }

  const canonical = toCanonicalPersonRef({
    requestedSourceType,
    member,
    lead,
    fallbackDisplayName: clean(input.displayName)
  });

  if (expectedType === "member" && !canonical.memberId) {
    const resolutionHint =
      candidateMemberId && !memberFromId
        ? `Supplied memberId ${candidateMemberId} did not resolve to an existing canonical members.id row visible to this request.`
        : null;
    throw new Error(
      buildIdentityErrorMessage({
        expectedType,
        actionLabel,
        incomingSourceType: requestedSourceType,
        candidateLeadId,
        candidateMemberId,
        selectedId,
        externalId,
        legacyId,
        resolutionHint
      })
    );
  }
  if (expectedType === "lead" && !canonical.leadId) {
    const resolutionHint =
      candidateLeadId && !leadFromId
        ? `Supplied leadId ${candidateLeadId} did not resolve to an existing canonical leads.id row visible to this request.`
        : null;
    throw new Error(
      buildIdentityErrorMessage({
        expectedType,
        actionLabel,
        incomingSourceType: requestedSourceType,
        candidateLeadId,
        candidateMemberId,
        selectedId,
        externalId,
        legacyId,
        resolutionHint
      })
    );
  }

  debugCanonicalIdentity("resolved", {
    actionLabel,
    sourceType: canonical.sourceType,
    leadId: canonical.leadId ?? "",
    memberId: canonical.memberId ?? "",
    workflow: canonical.safeWorkflowType,
    enrollmentStatus: canonical.enrollmentStatus
  });

  return canonical;
}

export async function resolveCanonicalMemberRef(
  input: CanonicalPersonRefInput,
  options?: { actionLabel?: string; serviceRole?: boolean }
) {
  const canonical = await resolveCanonicalPersonRef(input, {
    expectedType: "member",
    actionLabel: options?.actionLabel,
    serviceRole: options?.serviceRole
  });
  if (!canonical.memberId) {
    throw new Error(
      `${clean(options?.actionLabel) ?? "identity resolution"} expected member.id, but canonical member was missing.`
    );
  }
  return canonical;
}

export async function resolveCanonicalMemberId(
  input: CanonicalMemberRefInput | string,
  options?: { actionLabel?: string; serviceRole?: boolean }
) {
  const canonical = await resolveCanonicalMemberRef(
    assertCanonicalMemberResolverInput(input, clean(options?.actionLabel) ?? "identity resolution"),
    options
  );
  if (!canonical.memberId) {
    throw new Error(
      `${clean(options?.actionLabel) ?? "identity resolution"} expected member.id, but canonical member was missing.`
    );
  }
  return canonical.memberId;
}

export async function resolveCanonicalLeadRef(
  input: CanonicalPersonRefInput,
  options?: { actionLabel?: string; serviceRole?: boolean }
) {
  const canonical = await resolveCanonicalPersonRef(input, {
    expectedType: "lead",
    actionLabel: options?.actionLabel,
    serviceRole: options?.serviceRole
  });
  if (!canonical.leadId) {
    throw new Error(
      `${clean(options?.actionLabel) ?? "identity resolution"} expected lead.id, but canonical lead was missing.`
    );
  }
  return canonical;
}
