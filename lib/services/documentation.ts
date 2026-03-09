import { getMockDocumentationSummary, getMockDocumentationTracker, getMockMembers } from "@/lib/mock-data";
import { getMappedMemberIdForLead, getMockDb } from "@/lib/mock-repo";
import { canonicalLeadStage } from "@/lib/canonical";
import { isMockMode } from "@/lib/runtime";
import { createClient } from "@/lib/supabase/server";

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
  if (isMockMode()) {
    // TODO(backend): Remove mock branch when members are loaded from Supabase in local/dev.
    return getMockMembers();
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("members")
    .select("id, display_name, status, enrollment_date")
    .eq("status", "active")
    .order("display_name");
  return data ?? [];
}
export async function getAssessmentMembers() {
  if (isMockMode()) {
    // Intake assessment picker is lead-driven (Tour / Enrollment in Progress).
    const db = getMockDb();
    const candidates = db.leads
      .filter((lead) => {
        const stage = canonicalLeadStage(String(lead.stage ?? lead.status ?? ""));
        return stage === "Enrollment in Progress" || stage === "EIP" || stage === "Tour";
      })
      .map((lead) => {
        const stage = canonicalLeadStage(String(lead.stage ?? lead.status ?? ""));
        const linkedMemberId =
          getMappedMemberIdForLead(lead.id) ??
          db.assessments.find((assessment) => assessment.lead_id === lead.id)?.member_id ??
          null;
        return {
          id: lead.id,
          display_name: lead.member_name,
          lead_id: lead.id,
          lead_stage: stage,
          lead_status: lead.status,
          linked_member_id: linkedMemberId
        };
      });

    return candidates
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .sort((a, b) => {
        if (a.lead_stage !== b.lead_stage) return a.lead_stage.localeCompare(b.lead_stage);
        return a.display_name.localeCompare(b.display_name);
      });
  }

  // TODO(backend): return Tour/EIP lead-linked intake candidates from canonical lead source.
  return getMembers();
}

export async function getDocumentationSummary() {
  if (isMockMode()) {
    // TODO(backend): Remove mock branch when documentation summaries are loaded from Supabase in local/dev.
    const mock = getMockDocumentationSummary();
    return {
      today: normalizeTodayRows(mock.today),
      timely: normalizeTimelyRows(mock.timely)
    };
  }

  const supabase = await createClient();
  const { data: today } = await supabase.from("v_today_at_a_glance").select("*");
  const { data: timely } = await supabase
    .from("v_timely_docs_summary")
    .select("*")
    .order("on_time_percent", { ascending: false })
    .limit(10);

  return {
    today: normalizeTodayRows(today ?? []),
    timely: normalizeTimelyRows(timely ?? [])
  };
}

export async function getDocumentationTracker() {
  if (isMockMode()) {
    // TODO(backend): Remove mock branch when documentation tracker data is loaded from Supabase in local/dev.
    return getMockDocumentationTracker();
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("documentation_tracker")
    .select("id, member_name, assigned_staff_name, next_care_plan_due, next_progress_note_due, care_plan_done, note_done")
    .order("next_care_plan_due");

  return data ?? [];
}





