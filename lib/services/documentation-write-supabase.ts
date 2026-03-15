import "server-only";

import { createClient } from "@/lib/supabase/server";
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
}
