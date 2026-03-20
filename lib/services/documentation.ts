import { listCanonicalMemberLinksForLeadIds } from "@/lib/services/canonical-person-ref";
import { getProgressNoteReminderRows } from "@/lib/services/progress-notes";
import { listActiveMemberLookupSupabase } from "@/lib/services/shared-lookups-supabase";
import { createClient } from "@/lib/supabase/server";
import type { CanonicalPersonRef } from "@/types/identity";

function toCount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed.endsWith("%")) {
      return 0;
    }

    const numeric = Number(trimmed.replace(/,/g, ""));
    if (Number.isFinite(numeric)) {
      return Math.max(0, Math.round(numeric));
    }
  }

  return 0;
}

function toFraction(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1) {
      return Math.max(0, Math.min(1, value / 100));
    }

    return Math.max(0, Math.min(1, value));
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return 0;
    }

    const cleaned = trimmed.endsWith("%") ? trimmed.slice(0, -1) : trimmed;
    const numeric = Number(cleaned.replace(/,/g, ""));
    if (Number.isFinite(numeric)) {
      return numeric > 1 ? Math.max(0, Math.min(1, numeric / 100)) : Math.max(0, Math.min(1, numeric));
    }
  }

  return 0;
}

function toBool(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "yes" || normalized === "1";
  }

  return false;
}

function normalizeTodayRows(rows: unknown[]) {
  return rows.map((row) => {
    const source = (row ?? {}) as Record<string, unknown>;

    const participationCount = toCount(source.participation_count ?? source.participation ?? source.participation_logs);
    const toiletCount = toCount(source.toilet_count ?? source.toilet ?? source.toilet_logs);
    const showerCount = toCount(source.shower_count ?? source.shower ?? source.shower_logs);
    const transportCount = toCount(source.transport_count ?? source.transportation_count ?? source.transportation ?? source.transport_logs);
    const ancillaryCount = toCount(source.ancillary_count ?? source.ancillary ?? source.ancillary_logs);

    const fallbackTotal = participationCount + toiletCount + showerCount + transportCount + ancillaryCount;
    const totalCount = toCount(source.total_count ?? source.total ?? source.entries_total) || fallbackTotal;

    return {
      ...source,
      staff_name: String(source.staff_name ?? source.staff ?? "Unknown"),
      participation_count: participationCount,
      toilet_count: toiletCount,
      shower_count: showerCount,
      transport_count: transportCount,
      ancillary_count: ancillaryCount,
      total_count: totalCount,
      uploaded_today: source.uploaded_today == null ? totalCount > 0 : toBool(source.uploaded_today)
    };
  });
}

function normalizeTimelyRows(rows: unknown[]) {
  return rows.map((row) => {
    const source = (row ?? {}) as Record<string, unknown>;
    const onTime = toCount(source.on_time ?? source.onTime ?? source.on_time_count);
    const late = toCount(source.late ?? source.late_count);
    const total = toCount(source.total ?? source.total_count) || onTime + late;

    return {
      ...source,
      staff_name: String(source.staff_name ?? source.staff ?? "Unknown"),
      on_time: onTime,
      late,
      total,
      on_time_percent: source.on_time_percent == null ? (total > 0 ? onTime / total : 0) : toFraction(source.on_time_percent)
    };
  });
}

export async function getMembers() {
  return listActiveMemberLookupSupabase();
}
export async function getAssessmentMembers() {
  const supabase = await createClient();
  const { data: leads, error: leadsError } = await supabase
    .from("leads")
    .select("id, member_name, stage, status")
    .in("stage", ["Tour", "Enrollment in Progress"])
    .order("member_name", { ascending: true });
  if (leadsError) throw new Error(`Unable to load leads for assessment members: ${leadsError.message}`);

  const leadIds = (leads ?? []).map((lead: any) => String(lead.id)).filter(Boolean);
  const canonicalMemberLinksByLeadId = await listCanonicalMemberLinksForLeadIds(leadIds, {
    actionLabel: "getAssessmentMembers"
  });

  return (leads ?? []).map((lead: any) => {
    const linkedMember = canonicalMemberLinksByLeadId.get(String(lead.id)) ?? null;
    const memberStatus = linkedMember?.memberStatus ?? null;
    const canonicalRow = {
      sourceType: linkedMember ? "member" : "lead",
      leadId: String(lead.id),
      memberId: linkedMember ? String(linkedMember.memberId) : null,
      displayName: String(linkedMember?.displayName ?? lead.member_name ?? "Unknown Person"),
      memberStatus,
      leadStage: String(lead.stage ?? ""),
      leadStatus: String(lead.status ?? ""),
      enrollmentStatus: linkedMember ? (memberStatus === "active" ? "enrolled-active" : "enrolled-inactive") : "not-enrolled",
      safeWorkflowType: linkedMember ? "hybrid" : "lead-only"
    } satisfies CanonicalPersonRef;
    return canonicalRow;
  });
}

export async function getDocumentationSummary() {
  const supabase = await createClient();
  const { data: today, error: todayError } = await supabase.from("v_today_at_a_glance").select("*");
  const { data: timely, error: timelyError } = await supabase
    .from("v_timely_docs_summary")
    .select("*")
    .order("on_time_percent", { ascending: false })
    .limit(10);
  if (todayError) throw new Error(`Unable to load v_today_at_a_glance: ${todayError.message}`);
  if (timelyError) throw new Error(`Unable to load v_timely_docs_summary: ${timelyError.message}`);

  return {
    today: normalizeTodayRows(today ?? []),
    timely: normalizeTimelyRows(timely ?? [])
  };
}

export async function getDocumentationTracker() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documentation_tracker")
    .select("id, member_id, member_name, assigned_staff_name, next_care_plan_due, next_progress_note_due, care_plan_done, note_done")
    .order("next_care_plan_due");
  if (error) throw new Error(`Unable to load documentation_tracker: ${error.message}`);

  const trackerRows = (data ?? []) as Array<{
    id: string;
    member_id: string | null;
    member_name: string;
    assigned_staff_name: string | null;
    next_care_plan_due: string | null;
    next_progress_note_due: string | null;
    care_plan_done: boolean | null;
    note_done: boolean | null;
  }>;
  const memberIds = trackerRows.map((row) => row.member_id).filter((value): value is string => Boolean(value));
  const progressNotes = await getProgressNoteReminderRows(memberIds, { serviceRole: true });
  const progressByMemberId = new Map(progressNotes.map((row) => [row.memberId, row] as const));

  return trackerRows.map((row) => {
    const progress = row.member_id ? progressByMemberId.get(row.member_id) ?? null : null;
    return {
      ...row,
      next_progress_note_due: progress?.nextProgressNoteDueDate ?? row.next_progress_note_due ?? null,
      progress_note_status: progress?.complianceStatus ?? "data_issue",
      has_progress_note_draft: progress?.hasDraftInProgress ?? false
    };
  });
}

export async function getRecentDocumentationWorkflowCounts() {
  const supabase = await createClient();

  const [
    { data: toiletRows, error: toiletError },
    { data: showerRows, error: showerError },
    { data: transportationRows, error: transportationError },
    { data: photoRows, error: photoError },
    { data: assessmentRows, error: assessmentError }
  ] = await Promise.all([
    supabase.from("toilet_logs").select("id").order("event_at", { ascending: false }).limit(50),
    supabase.from("shower_logs").select("id").order("event_at", { ascending: false }).limit(50),
    supabase.from("transportation_logs").select("id").order("created_at", { ascending: false }).limit(50),
    supabase.from("member_photo_uploads").select("id").order("uploaded_at", { ascending: false }).limit(50),
    supabase.from("intake_assessments").select("id").order("created_at", { ascending: false }).limit(50)
  ]);

  if (toiletError) throw new Error(`Unable to load recent toilet workflow counts: ${toiletError.message}`);
  if (showerError) throw new Error(`Unable to load recent shower workflow counts: ${showerError.message}`);
  if (transportationError) {
    throw new Error(`Unable to load recent transportation workflow counts: ${transportationError.message}`);
  }
  if (photoError) throw new Error(`Unable to load recent photo workflow counts: ${photoError.message}`);
  if (assessmentError) throw new Error(`Unable to load recent assessment workflow counts: ${assessmentError.message}`);

  return {
    toilets: toiletRows?.length ?? 0,
    showers: showerRows?.length ?? 0,
    transportation: transportationRows?.length ?? 0,
    photos: photoRows?.length ?? 0,
    assessments: assessmentRows?.length ?? 0
  };
}






