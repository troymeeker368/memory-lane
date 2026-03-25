import "server-only";

import { randomUUID } from "node:crypto";

import { normalizeStoredIntakePayload } from "@/lib/services/enrollment-packet-core";
import {
  getEnrollmentPacketSenderSignatureProfile,
  getLeadById,
  getMemberById,
  listEnrollmentPacketMemberFileArtifacts,
  loadEnrollmentPacketArtifactOps,
  loadPacketFields,
  loadRequestById,
  recordEnrollmentPacketSubmittedMilestone,
  runEnrollmentPacketDownstreamMapping,
  syncEnrollmentPacketLeadActivityOrQueue
} from "@/lib/services/enrollment-packet-mapping-runtime";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { toEasternISO } from "@/lib/timezone";
import type {
  EnrollmentPacketFieldsRow,
  EnrollmentPacketRequestRow,
  EnrollmentPacketUploadCategory,
  MemberRow
} from "@/lib/services/enrollment-packet-types";

type EnrollmentPacketMemberFileArtifact = {
  uploadCategory: EnrollmentPacketUploadCategory;
  memberFileId: string | null;
};

type EnrollmentPacketCompletionCascadeInput = {
  request: EnrollmentPacketRequestRow;
  member: MemberRow;
  fields?: EnrollmentPacketFieldsRow | null;
  senderSignatureName?: string | null;
  caregiverEmail?: string | null;
  memberFileArtifacts?: EnrollmentPacketMemberFileArtifact[] | null;
  actorType: "user" | "system";
  ensureCompletedPacketArtifact?: boolean;
};

export type EnrollmentPacketCompletionCascadeResult = {
  packetId: string;
  memberId: string;
  leadId: string | null;
  mappingRunId: string | null;
  mappingStatus: "completed" | "failed";
  senderNotificationDelivered: boolean;
  senderNotificationCount: number;
  completedPacketArtifactCreated: boolean;
  leadActivitySynced: boolean;
};

function toCompletedStatus(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "completed" || normalized === "filed";
}

async function hasLeadCompletionActivity(input: {
  leadId: string;
  packetId: string;
}) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("lead_activities")
    .select("id")
    .eq("lead_id", input.leadId)
    .ilike("notes", `%${input.packetId}%`)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data?.id);
}

async function resolveCaregiverSignatureName(input: {
  packetId: string;
  fallbackName: string | null | undefined;
}) {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("enrollment_packet_signatures")
    .select("signer_name")
    .eq("packet_id", input.packetId)
    .eq("signer_role", "caregiver")
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return String(data?.signer_name ?? "").trim() || String(input.fallbackName ?? "").trim() || "Caregiver";
}

async function ensureCompletedPacketArtifact(input: {
  request: EnrollmentPacketRequestRow;
  member: MemberRow;
  fields: EnrollmentPacketFieldsRow;
  senderSignatureName: string;
  existingArtifacts: EnrollmentPacketMemberFileArtifact[];
}) {
  const existingCompletedPacket = input.existingArtifacts.some(
    (artifact) => artifact.uploadCategory === "completed_packet" && Boolean(artifact.memberFileId)
  );
  if (existingCompletedPacket) {
    return {
      created: false,
      artifacts: input.existingArtifacts
    };
  }

  const artifactOps = await loadEnrollmentPacketArtifactOps();
  const caregiverSignatureName = await resolveCaregiverSignatureName({
    packetId: input.request.id,
    fallbackName: input.fields.caregiver_name
  });
  const packetDocx = await artifactOps.buildCompletedPacketArtifactData({
    memberName: input.member.display_name,
    request: input.request,
    fields: input.fields,
    intakePayload: normalizeStoredIntakePayload(input.fields),
    caregiverSignatureName,
    senderSignatureName: input.senderSignatureName
  });
  const repairedArtifact = await artifactOps.insertUploadAndFile({
    packetId: input.request.id,
    memberId: input.member.id,
    batchId: `repair-${randomUUID()}`,
    fileName: packetDocx.fileName,
    contentType: packetDocx.contentType,
    bytes: packetDocx.bytes,
    uploadCategory: "completed_packet",
    uploadedByUserId: input.request.sender_user_id,
    uploadedByName: input.senderSignatureName,
    dataUrl: packetDocx.dataUrl
  });

  return {
    created: true,
    artifacts: [
      ...input.existingArtifacts,
      {
        uploadCategory: "completed_packet" as const,
        memberFileId: repairedArtifact.memberFileId
      }
    ]
  };
}

async function ensureEnrollmentPacketLeadActivity(input: {
  request: EnrollmentPacketRequestRow;
  member: MemberRow;
  senderSignatureName: string;
}) {
  if (!input.request.lead_id) return true;
  if (await hasLeadCompletionActivity({ leadId: input.request.lead_id, packetId: input.request.id })) {
    return true;
  }

  const lead = await getLeadById(input.request.lead_id);
  return syncEnrollmentPacketLeadActivityOrQueue({
    packetId: input.request.id,
    memberId: input.member.id,
    leadId: input.request.lead_id,
    memberName: lead?.member_name ?? input.member.display_name,
    activityType: "Email",
    outcome: "Enrollment Packet Completed",
    notes: `Enrollment packet request ${input.request.id} completed by caregiver and filed to member records.`,
    completedByUserId: input.request.sender_user_id,
    completedByName: input.senderSignatureName,
    activityAt: input.request.completed_at ?? toEasternISO(),
    actionUrl: `/sales/leads/${input.request.lead_id}`
  });
}

export async function runEnrollmentPacketCompletionCascade(
  input: EnrollmentPacketCompletionCascadeInput
): Promise<EnrollmentPacketCompletionCascadeResult> {
  if (!toCompletedStatus(input.request.status)) {
    throw new Error("Enrollment packet completion cascade requires a filed or completed packet.");
  }

  const senderSignatureName =
    String(input.senderSignatureName ?? "").trim() ||
    (await getEnrollmentPacketSenderSignatureProfile(input.request.sender_user_id))?.signature_name ||
    "Staff";
  const fields = input.fields ?? (await loadPacketFields(input.request.id));
  if (!fields) {
    throw new Error("Enrollment packet fields are required for completion cascade.");
  }

  let memberFileArtifacts =
    input.memberFileArtifacts && input.memberFileArtifacts.length > 0
      ? input.memberFileArtifacts
      : await listEnrollmentPacketMemberFileArtifacts(input.request.id);
  let completedPacketArtifactCreated = false;

  if (input.ensureCompletedPacketArtifact !== false) {
    const artifactRepair = await ensureCompletedPacketArtifact({
      request: input.request,
      member: input.member,
      fields,
      senderSignatureName,
      existingArtifacts: memberFileArtifacts
    });
    memberFileArtifacts = artifactRepair.artifacts;
    completedPacketArtifactCreated = artifactRepair.created;
  }

  const mappingSummary =
    String(input.request.mapping_sync_status ?? "").trim().toLowerCase() === "completed"
      ? {
          mappingRunId: input.request.latest_mapping_run_id ?? null,
          status: "completed" as const
        }
      : await runEnrollmentPacketDownstreamMapping({
          request: input.request,
          member: input.member,
          fields,
          senderSignatureName,
          caregiverEmail: input.caregiverEmail ?? input.request.caregiver_email ?? null,
          memberFileArtifacts,
          actorType: input.actorType
        });

  const milestone = await recordEnrollmentPacketSubmittedMilestone({
    request: input.request,
    member: input.member,
    mappingSummary:
      mappingSummary.status === "completed"
        ? {
            mappingRunId: mappingSummary.mappingRunId,
            status: "completed",
            conflictsRequiringReview: 0
          }
        : {
            mappingRunId: mappingSummary.mappingRunId,
            status: "failed",
            conflictsRequiringReview: 0
          },
    completedAt: input.request.completed_at ?? toEasternISO(),
    actionUrl: input.request.lead_id ? `/sales/leads/${input.request.lead_id}` : `/operations/member-command-center/${input.member.id}`
  });
  const leadActivitySynced = await ensureEnrollmentPacketLeadActivity({
    request: input.request,
    member: input.member,
    senderSignatureName
  });

  return {
    packetId: input.request.id,
    memberId: input.member.id,
    leadId: input.request.lead_id,
    mappingRunId: mappingSummary.mappingRunId ?? null,
    mappingStatus: mappingSummary.status,
    senderNotificationDelivered: milestone.delivered,
    senderNotificationCount: milestone.notificationCount,
    completedPacketArtifactCreated,
    leadActivitySynced
  };
}

export async function repairEnrollmentPacketCompletionCascade(input: {
  packetId: string;
  actorType?: "user" | "system";
}) {
  const request = await loadRequestById(input.packetId);
  if (!request) {
    throw new Error("Enrollment packet request was not found for repair.");
  }
  if (!toCompletedStatus(request.status)) {
    throw new Error("Only filed or completed enrollment packets can be repaired.");
  }

  const member = await getMemberById(request.member_id);
  if (!member) {
    throw new Error("Member record was not found for enrollment packet repair.");
  }

  return runEnrollmentPacketCompletionCascade({
    request,
    member,
    actorType: input.actorType ?? "system",
    ensureCompletedPacketArtifact: true
  });
}

export async function repairCommittedEnrollmentPacketCompletions(input?: {
  packetIds?: string[];
  limit?: number;
}) {
  const requestedPacketIds = Array.from(
    new Set(
      (input?.packetIds ?? [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    )
  );
  let packetIds = requestedPacketIds;

  if (packetIds.length === 0) {
    packetIds = await listCommittedEnrollmentPacketCompletionRepairCandidates({ limit: input?.limit });
  }

  let repaired = 0;
  let failed = 0;
  const failures: Array<{ packetId: string; error: string }> = [];

  for (const packetId of packetIds) {
    try {
      await repairEnrollmentPacketCompletionCascade({ packetId, actorType: "system" });
      repaired += 1;
    } catch (error) {
      failed += 1;
      failures.push({
        packetId,
        error: error instanceof Error ? error.message : "Unknown enrollment packet repair failure."
      });
    }
  }

  return {
    processed: packetIds.length,
    repaired,
    failed,
    failures
  };
}

export async function listCommittedEnrollmentPacketCompletionRepairCandidates(input?: {
  limit?: number;
}) {
  const admin = createSupabaseAdminClient();
  const limit = Math.max(1, Math.min(100, Number(input?.limit ?? 25)));
  const candidateIds = new Set<string>();
  const pageSize = Math.max(25, Math.min(100, limit));
  let offset = 0;

  while (candidateIds.size < limit) {
    const { data, error } = await admin
      .from("enrollment_packet_requests")
      .select("id, mapping_sync_status")
      .in("status", ["completed", "filed"])
      .order("updated_at", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);

    const rows = ((data ?? []) as Array<{
      id: string;
      mapping_sync_status: string | null;
    }>).filter((row) => String(row.id ?? "").trim().length > 0);
    if (rows.length === 0) break;

    const packetIds = rows.map((row) => row.id);
    const [{ data: eventRows, error: eventError }, { data: uploadRows, error: uploadError }] = await Promise.all([
      admin
        .from("system_events")
        .select("entity_id")
        .eq("entity_type", "enrollment_packet_request")
        .eq("event_type", "enrollment_packet_submitted")
        .in("entity_id", packetIds),
      admin
        .from("enrollment_packet_uploads")
        .select("packet_id, member_file_id")
        .eq("upload_category", "completed_packet")
        .in("packet_id", packetIds)
    ]);
    if (eventError) throw new Error(eventError.message);
    if (uploadError) throw new Error(uploadError.message);

    const submittedEventPacketIds = new Set(
      ((eventRows ?? []) as Array<{ entity_id: string | null }>).map((row) => String(row.entity_id ?? "").trim()).filter(Boolean)
    );
    const completedArtifactPacketIds = new Set(
      ((uploadRows ?? []) as Array<{ packet_id: string; member_file_id: string | null }>)
        .filter((row) => String(row.member_file_id ?? "").trim().length > 0)
        .map((row) => row.packet_id)
    );

    for (const row of rows) {
      const mappingStatus = String(row.mapping_sync_status ?? "").trim().toLowerCase();
      const needsMappingRepair =
        !mappingStatus ||
        mappingStatus === "not_started" ||
        mappingStatus === "pending" ||
        mappingStatus === "failed";
      const missingSubmittedMilestone = !submittedEventPacketIds.has(row.id);
      const missingCompletedArtifact = !completedArtifactPacketIds.has(row.id);

      if (needsMappingRepair || missingSubmittedMilestone || missingCompletedArtifact) {
        candidateIds.add(row.id);
        if (candidateIds.size >= limit) break;
      }
    }

    offset += rows.length;
    if (rows.length < pageSize) break;
  }

  return Array.from(candidateIds);
}
