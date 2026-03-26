import "server-only";

import { Buffer } from "node:buffer";
import { normalizeRoleKey } from "@/lib/permissions";

import {
  asCategory,
  asDirectorDecision,
  asStatus,
  assertAdminAmendment,
  assertDirectorReviewer,
  assertIncidentReporter,
  clean,
  mapIncidentHistory,
  mapIncidentSummary,
  serializeIncidentSnapshot,
  statusSortValue,
  type ActorContext,
  type IncidentHistoryRow,
  type IncidentRow
} from "@/lib/services/incident-core";
import {
  type IncidentAmendmentInput,
  type IncidentCategory,
  type IncidentDashboard,
  type IncidentDetail,
  type IncidentDraftInput,
  type IncidentEditorLookups,
  type IncidentReviewInput,
  type IncidentStatus
} from "@/lib/services/incident-shared";
import { logSystemEvent } from "@/lib/services/system-event-service";
import { createClient } from "@/lib/supabase/server";
import { toEasternISO } from "@/lib/timezone";
export {
  INCIDENT_CATEGORY_OPTIONS,
  INCIDENT_DIRECTOR_DECISION_VALUES,
  INCIDENT_INJURY_TYPE_OPTIONS,
  INCIDENT_LOCATION_OPTIONS,
  INCIDENT_STATUS_VALUES
} from "@/lib/services/incident-shared";
export type {
  IncidentAmendmentInput,
  IncidentCategory,
  IncidentDashboard,
  IncidentDetail,
  IncidentDirectorDecision,
  IncidentDraftInput,
  IncidentEditorLookups,
  IncidentHistoryEntry,
  IncidentReviewInput,
  IncidentStatus,
  IncidentSummaryRow
} from "@/lib/services/incident-shared";
export type { IncidentLookupOption } from "@/lib/services/incident-shared";

async function loadIncidentArtifactsService() {
  return import("@/lib/services/incident-artifacts");
}

async function loadIncidentPdfBuilder() {
  const { buildIncidentPdfBytesFromDetail } = await import("@/lib/services/incident-pdf");
  return buildIncidentPdfBytesFromDetail;
}

async function loadMemberFilesService() {
  return import("@/lib/services/member-files");
}


function mapIncidentDetail(row: IncidentRow, history: IncidentHistoryRow[]): IncidentDetail {
  return {
    id: row.id,
    incidentNumber: row.incident_number,
    incidentCategory: asCategory(row.incident_category),
    reportable: Boolean(row.reportable),
    participantId: clean(row.participant_id),
    participantName: clean(row.participant_name_snapshot),
    staffMemberId: clean(row.staff_member_id),
    staffMemberName: clean(row.staff_member_name_snapshot),
    reporterUserId: row.reporter_user_id,
    reporterName: row.reporter_name_snapshot,
    additionalParties: clean(row.additional_parties),
    incidentDateTime: row.incident_datetime,
    reportedDateTime: row.reported_datetime,
    location: row.location,
    exactLocationDetails: clean(row.exact_location_details),
    description: row.description,
    unsafeConditionsPresent: Boolean(row.unsafe_conditions_present),
    unsafeConditionsDescription: clean(row.unsafe_conditions_description),
    injuredBy: clean(row.injured_by),
    injuryType: clean(row.injury_type),
    bodyPart: clean(row.body_part),
    generalNotes: clean(row.general_notes),
    followUpNote: clean(row.follow_up_note),
    status: asStatus(row.status),
    submittedAt: clean(row.submitted_at),
    submittedByUserId: clean(row.submitted_by_user_id),
    submittedByName: clean(row.submitted_by_name_snapshot),
    submitterSignatureAttested: Boolean(row.submitter_signature_attested),
    submitterSignatureName: clean(row.submitter_signature_name),
    submitterSignedAt: clean(row.submitter_signed_at),
    submitterSignatureArtifactStoragePath: clean(row.submitter_signature_artifact_storage_path),
    directorReviewedBy: clean(row.director_reviewed_by),
    directorReviewedAt: clean(row.director_reviewed_at),
    directorDecision: asDirectorDecision(row.director_decision),
    directorSignatureName: clean(row.director_signature_name),
    directorReviewNotes: clean(row.director_review_notes),
    finalPdfMemberFileId: clean(row.final_pdf_member_file_id),
    finalPdfStorageObjectPath: clean(row.final_pdf_storage_object_path),
    finalPdfSavedAt: clean(row.final_pdf_saved_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    history: history.map(mapIncidentHistory)
  };
}

async function getServiceClient() {
  return createClient({ serviceRole: true });
}

async function loadIncidentRow(incidentId: string) {
  const supabase = await getServiceClient();
  const { data, error } = await supabase.from("incidents").select("*").eq("id", incidentId).maybeSingle();
  if (error) throw new Error(`Unable to load incident: ${error.message}`);
  return (data as IncidentRow | null) ?? null;
}

async function loadIncidentHistoryRows(incidentId: string) {
  const supabase = await getServiceClient();
  const { data, error } = await supabase
    .from("incident_history")
    .select("*")
    .eq("incident_id", incidentId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Unable to load incident history: ${error.message}`);
  return (data ?? []) as IncidentHistoryRow[];
}

async function loadProfileSnapshot(profileId: string | null | undefined) {
  const normalized = clean(profileId);
  if (!normalized) return null;
  const supabase = await getServiceClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", normalized)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(`Unable to load staff profile: ${error.message}`);
  if (!data) throw new Error("Selected staff member could not be found.");
  return {
    id: String(data.id),
    fullName: clean((data as { full_name?: string | null }).full_name) ?? "Unknown Staff",
    role: clean((data as { role?: string | null }).role)
  };
}

async function loadMemberSnapshot(memberId: string | null | undefined) {
  const normalized = clean(memberId);
  if (!normalized) return null;
  const supabase = await getServiceClient();
  const { data, error } = await supabase
    .from("members")
    .select("id, display_name")
    .eq("id", normalized)
    .maybeSingle();
  if (error) throw new Error(`Unable to load participant: ${error.message}`);
  if (!data) throw new Error("Selected participant could not be found.");
  return {
    id: String(data.id),
    displayName: clean((data as { display_name?: string | null }).display_name) ?? "Unknown Participant"
  };
}

async function hydrateSnapshots(input: {
  participantId?: string | null;
  staffMemberId?: string | null;
  reporterUserId: string;
}) {
  const [participant, staffMember, reporter] = await Promise.all([
    loadMemberSnapshot(input.participantId),
    loadProfileSnapshot(input.staffMemberId),
    loadProfileSnapshot(input.reporterUserId)
  ]);
  if (!reporter) throw new Error("Reporter profile could not be found.");
  return {
    participantId: participant?.id ?? null,
    participantNameSnapshot: participant?.displayName ?? null,
    staffMemberId: staffMember?.id ?? null,
    staffMemberNameSnapshot: staffMember?.fullName ?? null,
    reporterUserId: reporter.id,
    reporterNameSnapshot: reporter.fullName
  };
}

function validateDraftPayload(input: IncidentDraftInput) {
  const incidentCategory = asCategory(input.incidentCategory);
  const location = clean(input.location);
  const description = clean(input.description);
  const incidentDateTime = clean(input.incidentDateTime);
  const reportedDateTime = clean(input.reportedDateTime);
  if (!location) throw new Error("Location is required.");
  if (!description) throw new Error("Description is required.");
  if (!incidentDateTime) throw new Error("Incident date and time are required.");
  if (!reportedDateTime) throw new Error("Reported date and time are required.");
  if (input.unsafeConditionsPresent && !clean(input.unsafeConditionsDescription)) {
    throw new Error("Describe the unsafe conditions before saving.");
  }
  return {
    incidentCategory,
    location,
    description,
    incidentDateTime,
    reportedDateTime
  };
}

function validateSubmissionPayload(input: IncidentDraftInput) {
  const validated = validateDraftPayload(input);
  if (!clean(input.followUpNote) && !clean(input.generalNotes)) {
    throw new Error("Add either general notes or a follow-up note before submitting.");
  }
  if (!input.submitterSignatureAttested) {
    throw new Error("Confirm the submitter e-sign attestation before submitting this incident.");
  }
  if (!clean(input.submitterSignatureImageDataUrl)) {
    throw new Error("Draw your signature before submitting this incident.");
  }
  return validated;
}

function assertSubmitterEsign(input: IncidentDraftInput, actor: ActorContext) {
  const signatureImageDataUrl = clean(input.submitterSignatureImageDataUrl);
  if (!input.submitterSignatureAttested) {
    throw new Error("Confirm the submitter e-sign attestation before submitting this incident.");
  }
  if (!signatureImageDataUrl) {
    throw new Error("Draw your signature before submitting this incident.");
  }
  return {
    signatureName: actor.fullName,
    signatureImageDataUrl
  };
}

async function insertIncidentHistory(input: {
  incidentId: string;
  action: string;
  actor: ActorContext;
  notes?: string | null;
  previousValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
}) {
  const supabase = await getServiceClient();
  const { error } = await supabase.from("incident_history").insert({
    incident_id: input.incidentId,
    action: input.action,
    user_id: input.actor.id,
    user_name_snapshot: input.actor.fullName,
    notes: clean(input.notes),
    previous_value: input.previousValue ?? null,
    new_value: input.newValue ?? null
  });
  if (error) throw new Error(`Unable to write incident history: ${error.message}`);
}

async function logIncidentEvent(input: {
  eventType: string;
  incidentId: string;
  actor: ActorContext;
  status?: string | null;
  metadata?: Parameters<typeof logSystemEvent>[0]["metadata"];
}) {
  await logSystemEvent({
    event_type: input.eventType,
    entity_type: "incident",
    entity_id: input.incidentId,
    actor_type: "user",
    actor_id: input.actor.id,
    actor_user_id: input.actor.id,
    status: input.status ?? null,
    severity: "low",
    metadata: (input.metadata ?? {}) as Parameters<typeof logSystemEvent>[0]["metadata"]
  });
}

function buildDraftPatch(input: {
  draft: IncidentDraftInput;
  snapshots: Awaited<ReturnType<typeof hydrateSnapshots>>;
  existing?: IncidentRow | null;
}) {
  return {
    incident_category: asCategory(input.draft.incidentCategory),
    reportable: Boolean(input.draft.reportable),
    participant_id: input.snapshots.participantId,
    participant_name_snapshot: input.snapshots.participantNameSnapshot,
    staff_member_id: input.snapshots.staffMemberId,
    staff_member_name_snapshot: input.snapshots.staffMemberNameSnapshot,
    reporter_user_id: input.snapshots.reporterUserId,
    reporter_name_snapshot: input.snapshots.reporterNameSnapshot,
    additional_parties: clean(input.draft.additionalParties),
    incident_datetime: input.draft.incidentDateTime,
    reported_datetime: input.draft.reportedDateTime,
    location: clean(input.draft.location),
    exact_location_details: clean(input.draft.exactLocationDetails),
    description: clean(input.draft.description),
    unsafe_conditions_present: Boolean(input.draft.unsafeConditionsPresent),
    unsafe_conditions_description: input.draft.unsafeConditionsPresent ? clean(input.draft.unsafeConditionsDescription) : null,
    injured_by: clean(input.draft.injuredBy),
    injury_type: clean(input.draft.injuryType),
    body_part: clean(input.draft.bodyPart),
    general_notes: clean(input.draft.generalNotes),
    follow_up_note: clean(input.draft.followUpNote),
    status: input.existing ? input.existing.status : "draft"
  };
}

function assertEditableIncident(existing: IncidentRow, actor: ActorContext) {
  const status = asStatus(existing.status);
  if (status === "approved" || status === "closed") {
    throw new Error("Approved incidents are locked. Use the admin amendment flow for further changes.");
  }
  if (status === "submitted") {
    throw new Error("Submitted incidents are awaiting director review and cannot be edited.");
  }
  const role = normalizeRoleKey(actor.role);
  if (role !== "admin" && existing.reporter_user_id !== actor.id) {
    throw new Error("Only the original reporter can edit this incident before approval.");
  }
}

async function saveIncidentInternal(input: {
  draft: IncidentDraftInput;
  actor: ActorContext;
  action: "created" | "edited";
  validate: (payload: IncidentDraftInput) => {
    incidentCategory: IncidentCategory;
    location: string;
    description: string;
    incidentDateTime: string;
    reportedDateTime: string;
  };
}) {
  assertIncidentReporter(input.actor);
  input.validate(input.draft);
  const snapshots = await hydrateSnapshots({
    participantId: input.draft.participantId,
    staffMemberId: input.draft.staffMemberId,
    reporterUserId: input.actor.id
  });
  const supabase = await getServiceClient();
  const existing = clean(input.draft.incidentId) ? await loadIncidentRow(String(input.draft.incidentId)) : null;

  if (!existing) {
    const patch = buildDraftPatch({
      draft: input.draft,
      snapshots
    });
    const { data, error } = await supabase
      .from("incidents")
      .insert({
        ...patch,
        reporter_user_id: input.actor.id,
        reporter_name_snapshot: snapshots.reporterNameSnapshot,
        status: "draft"
      })
      .select("*")
      .maybeSingle();
    if (error || !data) throw new Error(`Unable to save incident draft: ${error?.message ?? "Unknown incident save error."}`);
    const created = data as IncidentRow;
    await insertIncidentHistory({
      incidentId: created.id,
      action: "created",
      actor: input.actor,
      newValue: serializeIncidentSnapshot(created)
    });
    await logIncidentEvent({
      eventType: "incident_created",
      incidentId: created.id,
      actor: input.actor,
      status: created.status,
      metadata: {
        incident_number: created.incident_number
      }
    });
    return created;
  }

  assertEditableIncident(existing, input.actor);
  const patch = buildDraftPatch({
    draft: input.draft,
    snapshots,
    existing
  });
  const { data, error } = await supabase.from("incidents").update(patch).eq("id", existing.id).select("*").maybeSingle();
  if (error || !data) throw new Error(`Unable to update incident draft: ${error?.message ?? "Unknown incident update error."}`);
  const updated = data as IncidentRow;
  await insertIncidentHistory({
    incidentId: updated.id,
    action: input.action,
    actor: input.actor,
    previousValue: serializeIncidentSnapshot(existing),
    newValue: serializeIncidentSnapshot(updated)
  });
  await logIncidentEvent({
    eventType: "incident_updated",
    incidentId: updated.id,
    actor: input.actor,
    status: updated.status,
    metadata: {
      incident_number: updated.incident_number
    }
  });
  return updated;
}

export async function listIncidentLookups() {
  const supabase = await getServiceClient();
  const [membersResult, profilesResult] = await Promise.all([
    supabase.from("members").select("id, display_name").eq("status", "active").order("display_name", { ascending: true }),
    supabase
      .from("profiles")
      .select("id, full_name, role")
      .eq("active", true)
      .order("full_name", { ascending: true })
  ]);
  if (membersResult.error) throw new Error(`Unable to load incident participants: ${membersResult.error.message}`);
  if (profilesResult.error) throw new Error(`Unable to load staff members for incident form: ${profilesResult.error.message}`);

  const memberRows = (membersResult.data ?? []) as Array<{ id: string; display_name: string | null }>;
  const profileRows = (profilesResult.data ?? []) as Array<{ id: string; full_name: string | null; role: string | null }>;

  return {
    participants: memberRows.map((row) => ({
      id: String(row.id),
      label: clean(row.display_name) ?? "Unknown Participant"
    })),
    staffMembers: profileRows.map((row) => ({
      id: String(row.id),
      label: clean(row.full_name) ?? "Unknown Staff",
      subtitle: clean(row.role)
    }))
  } satisfies IncidentEditorLookups;
}

export async function listIncidentDashboard(options?: { limit?: number }) {
  const supabase = await getServiceClient();
  const limit = Math.max(5, Math.min(options?.limit ?? 25, 100));
  const [recentResult, totalCount, submittedCount, returnedCount, approvedCount, reportableOpenCount] = await Promise.all([
    supabase
      .from("incidents")
      .select(
        "id, incident_number, incident_category, reportable, participant_name_snapshot, staff_member_name_snapshot, reporter_name_snapshot, incident_datetime, location, status, updated_at"
      )
      .order("incident_datetime", { ascending: false })
      .limit(limit),
    supabase.from("incidents").select("id", { count: "exact", head: true }),
    supabase.from("incidents").select("id", { count: "exact", head: true }).eq("status", "submitted"),
    supabase.from("incidents").select("id", { count: "exact", head: true }).eq("status", "returned"),
    supabase.from("incidents").select("id", { count: "exact", head: true }).eq("status", "approved"),
    supabase
      .from("incidents")
      .select("id", { count: "exact", head: true })
      .eq("reportable", true)
      .in("status", ["draft", "submitted", "returned", "approved"])
  ]);
  if (recentResult.error) throw new Error(`Unable to load incidents: ${recentResult.error.message}`);
  if (totalCount.error) throw new Error(totalCount.error.message);
  if (submittedCount.error) throw new Error(submittedCount.error.message);
  if (returnedCount.error) throw new Error(returnedCount.error.message);
  if (approvedCount.error) throw new Error(approvedCount.error.message);
  if (reportableOpenCount.error) throw new Error(reportableOpenCount.error.message);

  const rows = ((recentResult.data ?? []) as IncidentRow[])
    .sort((left, right) => {
      const statusDelta = statusSortValue(asStatus(left.status)) - statusSortValue(asStatus(right.status));
      if (statusDelta !== 0) return statusDelta;
      return left.incident_datetime < right.incident_datetime ? 1 : -1;
    })
    .map(mapIncidentSummary);

  return {
    counts: {
      total: Number(totalCount.count ?? 0),
      submitted: Number(submittedCount.count ?? 0),
      returned: Number(returnedCount.count ?? 0),
      approved: Number(approvedCount.count ?? 0),
      reportableOpen: Number(reportableOpenCount.count ?? 0)
    },
    recent: rows
  } satisfies IncidentDashboard;
}

export async function getIncidentDetail(incidentId: string) {
  const [row, history] = await Promise.all([loadIncidentRow(incidentId), loadIncidentHistoryRows(incidentId)]);
  if (!row) return null;
  return mapIncidentDetail(row, history);
}

export async function saveIncidentDraft(input: IncidentDraftInput, actor: ActorContext) {
  const row = await saveIncidentInternal({
    draft: input,
    actor,
    action: input.incidentId ? "edited" : "created",
    validate: validateDraftPayload
  });
  return getIncidentDetail(row.id);
}

export async function submitIncident(input: IncidentDraftInput, actor: ActorContext) {
  assertIncidentReporter(actor);
  validateSubmissionPayload(input);
  const submitterEsign = assertSubmitterEsign(input, actor);
  const existing = clean(input.incidentId) ? await loadIncidentRow(String(input.incidentId)) : null;
  const saved =
    existing ??
    ((await saveIncidentInternal({
      draft: input,
      actor,
      action: "created",
      validate: validateSubmissionPayload
    })) as IncidentRow);

  if (existing) {
    assertEditableIncident(existing, actor);
    await saveIncidentInternal({
      draft: input,
      actor,
      action: "edited",
      validate: validateSubmissionPayload
    });
  }

  const current = await loadIncidentRow(saved.id);
  if (!current) throw new Error("Incident disappeared before submission.");

  const { deleteIncidentSubmitterSignatureArtifact, saveIncidentSubmitterSignatureArtifact } =
    await loadIncidentArtifactsService();
  const artifact = await saveIncidentSubmitterSignatureArtifact({
    incidentId: current.id,
    participantId: current.participant_id,
    signatureImageDataUrl: submitterEsign.signatureImageDataUrl
  });

  const supabase = await getServiceClient();
  const now = toEasternISO();
  const { data, error } = await supabase
    .from("incidents")
    .update({
      status: "submitted",
      submitted_at: now,
      submitted_by_user_id: actor.id,
      submitted_by_name_snapshot: actor.fullName,
      submitter_signature_attested: true,
      submitter_signature_name: submitterEsign.signatureName,
      submitter_signed_at: now,
      submitter_signature_artifact_storage_path: artifact.storagePath,
      director_reviewed_by: null,
      director_reviewed_at: null,
      director_decision: null,
      director_signature_name: null,
      director_review_notes: null,
      final_pdf_member_file_id: null,
      final_pdf_storage_object_path: null,
      final_pdf_saved_at: null
    })
    .eq("id", current.id)
    .select("*")
    .maybeSingle();
  if (error || !data) {
    await deleteIncidentSubmitterSignatureArtifact(artifact.storagePath);
    throw new Error(`Unable to submit incident: ${error?.message ?? "Unknown incident submit error."}`);
  }
  const submitted = data as IncidentRow;
  await insertIncidentHistory({
    incidentId: submitted.id,
    action: "submitted",
    actor,
    previousValue: serializeIncidentSnapshot(current),
    newValue: serializeIncidentSnapshot(submitted)
  });
  await logIncidentEvent({
    eventType: "incident_submitted",
    incidentId: submitted.id,
    actor,
    status: submitted.status,
    metadata: {
      incident_number: submitted.incident_number,
      reportable: submitted.reportable,
      submitter_signature_name: submitterEsign.signatureName
    }
  });
  return getIncidentDetail(submitted.id);
}

export async function reviewIncident(input: IncidentReviewInput, actor: ActorContext) {
  assertDirectorReviewer(actor);
  const incidentId = clean(input.incidentId);
  if (!incidentId) throw new Error("Incident is required.");
  const decision = asDirectorDecision(input.decision);
  if (!decision) throw new Error("A valid review decision is required.");

  const existing = await loadIncidentRow(incidentId);
  if (!existing) throw new Error("Incident not found.");
  if (asStatus(existing.status) !== "submitted") {
    throw new Error("Only submitted incidents can be reviewed.");
  }
  if (decision === "returned" && !clean(input.reviewNotes)) {
    throw new Error("Add review notes before returning an incident for correction.");
  }

  const now = toEasternISO();
  const status: IncidentStatus = decision === "approved" ? "approved" : "returned";
  let finalPdf:
    | {
        created: {
          id: string;
          storage_object_path: string | null;
        };
        generatedAtIso: string;
      }
    | null = null;

  if (decision === "approved" && existing.participant_id && existing.participant_name_snapshot) {
    const currentHistory = await loadIncidentHistoryRows(incidentId);
    const prospectiveDetail = mapIncidentDetail(
      {
        ...existing,
        status,
        director_reviewed_by: actor.id,
        director_reviewed_at: now,
        director_decision: decision,
        director_signature_name: actor.fullName,
        director_review_notes: clean(input.reviewNotes)
      },
      currentHistory
    );
    const { loadIncidentSubmitterSignatureDataUrl, saveFinalizedIncidentPdfToMemberFiles } =
      await loadIncidentArtifactsService();
    const buildIncidentPdfBytesFromDetail = await loadIncidentPdfBuilder();
    const submitterSignatureDataUrl = await loadIncidentSubmitterSignatureDataUrl(existing.submitter_signature_artifact_storage_path);
    const generated = await buildIncidentPdfBytesFromDetail(prospectiveDetail, {
      submitterSignatureDataUrl
    });
    finalPdf = await saveFinalizedIncidentPdfToMemberFiles({
      incidentId,
      memberId: existing.participant_id,
      memberName: existing.participant_name_snapshot,
      dataUrl: `data:application/pdf;base64,${Buffer.from(generated.bytes).toString("base64")}`,
      uploadedBy: {
        id: actor.id,
        name: actor.fullName
      }
    });
  }

  const supabase = await getServiceClient();
  const { data, error } = await supabase
    .from("incidents")
    .update({
      status,
      director_reviewed_by: actor.id,
      director_reviewed_at: now,
      director_decision: decision,
      director_signature_name: actor.fullName,
      director_review_notes: clean(input.reviewNotes),
      ...(decision === "approved"
        ? {
            final_pdf_member_file_id: finalPdf?.created.id ?? null,
            final_pdf_storage_object_path: String(finalPdf?.created.storage_object_path ?? "").trim() || null,
            final_pdf_saved_at: finalPdf?.generatedAtIso ?? now
          }
        : {}),
      ...(decision === "returned"
        ? {
            submitter_signature_attested: false,
            submitter_signature_name: null,
            submitter_signed_at: null,
            submitter_signature_artifact_storage_path: null
          }
        : {})
    })
    .eq("id", incidentId)
    .select("*")
    .maybeSingle();
  if (error || !data) {
    if (finalPdf?.created?.id) {
      const { deleteMemberDocumentObject, deleteMemberFileRecord } = await loadMemberFilesService();
      const finalPdfStorageObjectPath = String(finalPdf.created.storage_object_path ?? "").trim();
      if (finalPdfStorageObjectPath) {
        await deleteMemberDocumentObject(finalPdfStorageObjectPath);
      }
      await deleteMemberFileRecord(finalPdf.created.id);
    }
    throw new Error(`Unable to record director review: ${error?.message ?? "Unknown review error."}`);
  }
  const reviewed = data as IncidentRow;
  if (decision === "returned" && existing.submitter_signature_artifact_storage_path) {
    try {
      const { deleteIncidentSubmitterSignatureArtifact } = await loadIncidentArtifactsService();
      await deleteIncidentSubmitterSignatureArtifact(existing.submitter_signature_artifact_storage_path);
    } catch (cleanupError) {
      console.error("[incident-report] unable to cleanup returned signature artifact", cleanupError);
    }
  }
  await insertIncidentHistory({
    incidentId: reviewed.id,
    action: decision,
    actor,
    notes: input.reviewNotes,
    previousValue: serializeIncidentSnapshot(existing),
    newValue: serializeIncidentSnapshot(reviewed)
  });
  await logIncidentEvent({
    eventType: decision === "approved" ? "incident_approved" : "incident_returned",
    incidentId: reviewed.id,
    actor,
    status: reviewed.status,
    metadata: {
      incident_number: reviewed.incident_number,
      review_notes: clean(input.reviewNotes)
    }
  });
  return getIncidentDetail(reviewed.id);
}

export async function closeIncident(incidentId: string, actor: ActorContext, notes?: string | null) {
  assertDirectorReviewer(actor);
  const normalized = clean(incidentId);
  if (!normalized) throw new Error("Incident is required.");
  const existing = await loadIncidentRow(normalized);
  if (!existing) throw new Error("Incident not found.");
  if (asStatus(existing.status) !== "approved") {
    throw new Error("Only approved incidents can be closed.");
  }
  const supabase = await getServiceClient();
  const { data, error } = await supabase.from("incidents").update({ status: "closed" }).eq("id", normalized).select("*").maybeSingle();
  if (error || !data) throw new Error(`Unable to close incident: ${error?.message ?? "Unknown close error."}`);
  const closed = data as IncidentRow;
  await insertIncidentHistory({
    incidentId: closed.id,
    action: "closed",
    actor,
    notes,
    previousValue: serializeIncidentSnapshot(existing),
    newValue: serializeIncidentSnapshot(closed)
  });
  await logIncidentEvent({
    eventType: "incident_closed",
    incidentId: closed.id,
    actor,
    status: closed.status,
    metadata: {
      incident_number: closed.incident_number,
      close_notes: clean(notes)
    }
  });
  return getIncidentDetail(closed.id);
}

export async function amendApprovedIncident(input: IncidentAmendmentInput, actor: ActorContext) {
  assertAdminAmendment(actor);
  const incidentId = clean(input.incidentId);
  const amendmentNote = clean(input.amendmentNote);
  if (!incidentId) throw new Error("Incident is required.");
  if (!amendmentNote) throw new Error("An amendment note is required before changing an approved incident.");

  validateDraftPayload(input);
  const existing = await loadIncidentRow(incidentId);
  if (!existing) throw new Error("Incident not found.");
  const status = asStatus(existing.status);
  if (status !== "approved" && status !== "closed") {
    throw new Error("Only approved or closed incidents can be amended.");
  }

  const snapshots = await hydrateSnapshots({
    participantId: input.participantId,
    staffMemberId: input.staffMemberId,
    reporterUserId: existing.reporter_user_id
  });
  const patch = buildDraftPatch({
    draft: input,
    snapshots,
    existing
  });
  const supabase = await getServiceClient();
  const { data, error } = await supabase
    .from("incidents")
    .update({
      ...patch,
      status: existing.status
    })
    .eq("id", incidentId)
    .select("*")
    .maybeSingle();
  if (error || !data) throw new Error(`Unable to amend incident: ${error?.message ?? "Unknown amendment error."}`);
  const amended = data as IncidentRow;
  await insertIncidentHistory({
    incidentId: amended.id,
    action: "amended",
    actor,
    notes: amendmentNote,
    previousValue: serializeIncidentSnapshot(existing),
    newValue: serializeIncidentSnapshot(amended)
  });
  await logIncidentEvent({
    eventType: "incident_amended",
    incidentId: amended.id,
    actor,
    status: amended.status,
    metadata: {
      incident_number: amended.incident_number,
      amendment_note: amendmentNote
    }
  });
  return getIncidentDetail(amended.id);
}
