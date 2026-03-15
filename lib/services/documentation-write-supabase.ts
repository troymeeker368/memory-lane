import "server-only";

import { createClient } from "@/lib/supabase/server";
import { recordWorkflowEvent } from "@/lib/services/workflow-observability";
import { toEasternISO } from "@/lib/timezone";

type ParticipationUpdateInput = {
  id: string;
  activity1: number;
  reasonMissing1?: string;
  activity2: number;
  reasonMissing2?: string;
  activity3: number;
  reasonMissing3?: string;
  activity4: number;
  reasonMissing4?: string;
  activity5: number;
  reasonMissing5?: string;
  notes?: string | null;
};

async function recordDocumentationWorkflowEvent(input: {
  eventType: string;
  entityType: string;
  entityId: string;
  memberId?: string | null;
  actorUserId?: string | null;
  status: "created" | "updated" | "deleted";
  metadata?: Record<string, unknown>;
}) {
  await recordWorkflowEvent({
    eventType: input.eventType,
    entityType: input.entityType,
    entityId: input.entityId,
    actorType: "user",
    actorUserId: input.actorUserId ?? null,
    status: input.status,
    severity: "low",
    metadata: {
      member_id: input.memberId ?? null,
      ...(input.metadata ?? {})
    }
  });
}

export async function createDailyActivityLogSupabase(input: {
  memberId: string;
  activityDate: string;
  staffUserId: string;
  activity1: number;
  reasonMissing1?: string;
  activity2: number;
  reasonMissing2?: string;
  activity3: number;
  reasonMissing3?: string;
  activity4: number;
  reasonMissing4?: string;
  activity5: number;
  reasonMissing5?: string;
  notes?: string | null;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("daily_activity_logs")
    .insert({
      member_id: input.memberId,
      activity_date: input.activityDate,
      staff_user_id: input.staffUserId,
      activity_1_level: input.activity1,
      missing_reason_1: input.activity1 === 0 ? input.reasonMissing1?.trim() ?? null : null,
      activity_2_level: input.activity2,
      missing_reason_2: input.activity2 === 0 ? input.reasonMissing2?.trim() ?? null : null,
      activity_3_level: input.activity3,
      missing_reason_3: input.activity3 === 0 ? input.reasonMissing3?.trim() ?? null : null,
      activity_4_level: input.activity4,
      missing_reason_4: input.activity4 === 0 ? input.reasonMissing4?.trim() ?? null : null,
      activity_5_level: input.activity5,
      missing_reason_5: input.activity5 === 0 ? input.reasonMissing5?.trim() ?? null : null,
      notes: input.notes ?? null
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await recordDocumentationWorkflowEvent({
    eventType: "documentation_entry_created",
    entityType: "daily_activity_log",
    entityId: String(data.id),
    memberId: input.memberId,
    actorUserId: input.staffUserId,
    status: "created"
  });
  return { id: String(data.id) };
}

export async function createToiletLogSupabase(input: {
  memberId: string;
  eventAt: string;
  briefs: boolean;
  memberSupplied: boolean;
  useType: string;
  staffUserId: string;
  notes?: string | null;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("toilet_logs")
    .insert({
      member_id: input.memberId,
      event_at: input.eventAt,
      briefs: input.briefs,
      member_supplied: input.memberSupplied,
      use_type: input.useType,
      staff_user_id: input.staffUserId,
      notes: input.notes ?? null
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await recordDocumentationWorkflowEvent({
    eventType: "documentation_entry_created",
    entityType: "toilet_log",
    entityId: String(data.id),
    memberId: input.memberId,
    actorUserId: input.staffUserId,
    status: "created"
  });
  return { id: String(data.id) };
}

export async function createShowerLogSupabase(input: {
  memberId: string;
  eventAt: string;
  laundry: boolean;
  briefs: boolean;
  staffUserId: string;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shower_logs")
    .insert({
      member_id: input.memberId,
      event_at: input.eventAt,
      laundry: input.laundry,
      briefs: input.briefs,
      staff_user_id: input.staffUserId
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await recordDocumentationWorkflowEvent({
    eventType: "documentation_entry_created",
    entityType: "shower_log",
    entityId: String(data.id),
    memberId: input.memberId,
    actorUserId: input.staffUserId,
    status: "created"
  });
  return { id: String(data.id) };
}

export async function createTransportationLogSupabase(input: {
  memberId: string;
  period: string;
  transportType: string;
  serviceDate: string;
  staffUserId: string;
}) {
  const supabase = await createClient();
  const { data: memberRow, error: memberRowError } = await supabase
    .from("members")
    .select("display_name")
    .eq("id", input.memberId)
    .maybeSingle();
  if (memberRowError) {
    throw new Error(`Unable to load member for transportation log: ${memberRowError.message}`);
  }
  if (!memberRow) {
    throw new Error("Unable to load member for transportation log.");
  }

  const firstName = String(memberRow.display_name ?? "").trim().split(/\s+/)[0] ?? "";
  const createdAt = toEasternISO();
  const { data, error } = await supabase
    .from("transportation_logs")
    .insert({
      member_id: input.memberId,
      first_name: firstName,
      period: input.period,
      transport_type: input.transportType,
      service_date: input.serviceDate,
      staff_user_id: input.staffUserId
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const { error: eventError } = await supabase.from("documentation_events").insert({
    event_type: "transportation_logs",
    event_table: "transportation_logs",
    event_row_id: data.id,
    member_id: input.memberId,
    staff_user_id: input.staffUserId,
    event_at: createdAt
  });
  if (eventError) throw new Error(eventError.message);
  await recordDocumentationWorkflowEvent({
    eventType: "documentation_entry_created",
    entityType: "transportation_log",
    entityId: String(data.id),
    memberId: input.memberId,
    actorUserId: input.staffUserId,
    status: "created"
  });

  return { id: String(data.id) };
}

export async function createBloodSugarLogSupabase(input: {
  memberId: string;
  checkedAt: string;
  readingMgDl: number;
  nurseUserId: string;
  notes?: string | null;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("blood_sugar_logs")
    .insert({
      member_id: input.memberId,
      checked_at: input.checkedAt,
      reading_mg_dl: input.readingMgDl,
      nurse_user_id: input.nurseUserId,
      notes: input.notes ?? null
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await recordDocumentationWorkflowEvent({
    eventType: "documentation_entry_created",
    entityType: "blood_sugar_log",
    entityId: String(data.id),
    memberId: input.memberId,
    actorUserId: input.nurseUserId,
    status: "created"
  });
  return { id: String(data.id) };
}

export async function createPhotoUploadSupabase(input: {
  uploadedByUserId: string;
  uploadedAt: string;
  photoUrl: string;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_photo_uploads")
    .insert({
      member_id: null,
      photo_url: input.photoUrl,
      uploaded_by: input.uploadedByUserId,
      uploaded_at: input.uploadedAt
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const { error: eventError } = await supabase.from("documentation_events").insert({
    event_type: "member_photo_uploads",
    event_table: "member_photo_uploads",
    event_row_id: data.id,
    member_id: null,
    staff_user_id: input.uploadedByUserId,
    event_at: input.uploadedAt
  });
  if (eventError) throw new Error(eventError.message);
  await recordDocumentationWorkflowEvent({
    eventType: "documentation_entry_created",
    entityType: "member_photo_upload",
    entityId: String(data.id),
    actorUserId: input.uploadedByUserId,
    status: "created"
  });

  return { id: String(data.id) };
}

export async function updateDailyActivityParticipationSupabase(input: ParticipationUpdateInput) {
  const supabase = await createClient();
  const { data: updatedRows, error } = await supabase
    .from("daily_activity_logs")
    .update({
      activity_1_level: input.activity1,
      missing_reason_1: input.activity1 === 0 ? input.reasonMissing1?.trim() ?? null : null,
      activity_2_level: input.activity2,
      missing_reason_2: input.activity2 === 0 ? input.reasonMissing2?.trim() ?? null : null,
      activity_3_level: input.activity3,
      missing_reason_3: input.activity3 === 0 ? input.reasonMissing3?.trim() ?? null : null,
      activity_4_level: input.activity4,
      missing_reason_4: input.activity4 === 0 ? input.reasonMissing4?.trim() ?? null : null,
      activity_5_level: input.activity5,
      missing_reason_5: input.activity5 === 0 ? input.reasonMissing5?.trim() ?? null : null,
      notes: input.notes ?? null
    })
    .eq("id", input.id)
    .select("id");
  if (error) throw new Error(error.message);
  const updatedCount = updatedRows?.length ?? 0;
  if (updatedCount === 0) {
    throw new Error(`Daily activity log update failed: no row found for id ${input.id}.`);
  }
  if (updatedCount > 1) {
    throw new Error(`Daily activity log update failed: expected exactly one row for id ${input.id}, affected ${updatedCount}.`);
  }
  await recordDocumentationWorkflowEvent({
    eventType: "documentation_entry_updated",
    entityType: "daily_activity_log",
    entityId: input.id,
    status: "updated"
  });
}

export async function updateShowerLogSupabase(input: {
  id: string;
  laundry: boolean;
  briefs: boolean;
}) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("shower_logs")
    .update({ laundry: input.laundry, briefs: input.briefs })
    .eq("id", input.id);
  if (error) throw new Error(error.message);
  await recordDocumentationWorkflowEvent({
    eventType: "documentation_entry_updated",
    entityType: "shower_log",
    entityId: input.id,
    status: "updated"
  });
}

export async function updateTransportationLogSupabase(input: {
  id: string;
  period: string;
  transportType: string;
}) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("transportation_logs")
    .update({
      period: input.period,
      transport_type: input.transportType
    })
    .eq("id", input.id);
  if (error) throw new Error(error.message);
  await recordDocumentationWorkflowEvent({
    eventType: "documentation_entry_updated",
    entityType: "transportation_log",
    entityId: input.id,
    status: "updated"
  });
}

export async function updateBloodSugarLogSupabase(input: {
  id: string;
  readingMgDl: number;
  notes?: string | null;
}) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("blood_sugar_logs")
    .update({ reading_mg_dl: input.readingMgDl, notes: input.notes ?? null })
    .eq("id", input.id);
  if (error) throw new Error(error.message);
  await recordDocumentationWorkflowEvent({
    eventType: "documentation_entry_updated",
    entityType: "blood_sugar_log",
    entityId: input.id,
    status: "updated"
  });
}

export async function updateAncillaryLogNotesSupabase(input: {
  id: string;
  notes?: string | null;
}) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("ancillary_charge_logs")
    .update({ notes: input.notes ?? null })
    .eq("id", input.id);
  if (error) throw new Error(error.message);
  await recordDocumentationWorkflowEvent({
    eventType: "documentation_entry_updated",
    entityType: "ancillary_charge_log",
    entityId: input.id,
    status: "updated"
  });
}

export async function setAncillaryReconciliationSupabase(input: {
  id: string;
  status: "open" | "reconciled" | "void";
  note?: string;
  actorName: string;
}) {
  const supabase = await createClient();
  const nextPatch =
    input.status === "reconciled"
      ? {
          reconciliation_status: "reconciled",
          reconciled_by: input.actorName,
          reconciled_at: toEasternISO(),
          reconciliation_note: input.note?.trim() || "Reconciled by manager/admin review."
        }
      : {
          reconciliation_status: input.status,
          reconciled_by: null,
          reconciled_at: null,
          reconciliation_note:
            input.status === "void"
              ? input.note?.trim() || "Voided during reconciliation review."
              : input.note?.trim() || null
        };
  const { error } = await supabase.from("ancillary_charge_logs").update(nextPatch).eq("id", input.id);
  if (error) throw new Error(error.message);
  await recordDocumentationWorkflowEvent({
    eventType: "documentation_entry_updated",
    entityType: "ancillary_charge_log",
    entityId: input.id,
    status: "updated",
    metadata: {
      reconciliation_status: input.status
    }
  });
}

export async function deleteWorkflowRecordSupabase(input: {
  entity: string;
  id: string;
}) {
  const tableMap: Record<string, string> = {
    dailyActivities: "daily_activity_logs",
    toiletLogs: "toilet_logs",
    showerLogs: "shower_logs",
    transportationLogs: "transportation_logs",
    photoUploads: "member_photo_uploads",
    bloodSugarLogs: "blood_sugar_logs",
    ancillaryLogs: "ancillary_charge_logs",
    leads: "leads",
    leadActivities: "lead_activities",
    assessments: "intake_assessments"
  };
  const table = tableMap[input.entity];
  if (!table) throw new Error("Unknown entity.");
  const supabase = await createClient();
  const { error } = await supabase.from(table).delete().eq("id", input.id);
  if (error) throw new Error(error.message);
  await recordDocumentationWorkflowEvent({
    eventType: "documentation_entry_deleted",
    entityType: input.entity,
    entityId: input.id,
    status: "deleted"
  });
}
