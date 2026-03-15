import { getCarePlanDashboard } from "@/lib/services/care-plans";
import { getMarWorkflowSnapshot } from "@/lib/services/mar-workflow";
import { createClient } from "@/lib/supabase/server";

type DashboardMarRow = {
  id: string;
  member_name: string;
  medication_name: string;
  due_at: string;
  administered_at: string | null;
  nurse_name: string | null;
  status: string;
};

type DashboardBloodSugarRow = {
  id: string;
  checked_at: string;
  member_name: string;
  reading_mg_dl: number | string;
  nurse_name: string | null;
  notes: string | null;
};

function parseDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function getHealthDashboardData(options?: { includeCarePlans?: boolean }) {
  const supabase = await createClient();
  const emptyCarePlanDashboard = {
    summary: { total: 0, dueSoon: 0, dueNow: 0, overdue: 0, completedRecently: 0 },
    dueSoon: [],
    dueNow: [],
    overdue: [],
    recentlyCompleted: [],
    plans: [],
    page: 1,
    pageSize: 25,
    totalRows: 0,
    totalPages: 1
  };
  const [marSnapshot, bloodSugarResult, membersResult, carePlans] = await Promise.all([
    getMarWorkflowSnapshot({ historyLimit: 150, prnLimit: 150, serviceRole: true }),
    supabase
      .from("v_blood_sugar_logs_detailed")
      .select("id, checked_at, member_id, member_name, reading_mg_dl, nurse_name, notes")
      .order("checked_at", { ascending: false })
      .limit(100),
    supabase
      .from("members")
      .select("id, display_name, status, code_status")
      .eq("status", "active")
      .order("display_name", { ascending: true }),
    options?.includeCarePlans ? getCarePlanDashboard({ page: 1, pageSize: 25 }) : Promise.resolve(emptyCarePlanDashboard)
  ]);
  if (bloodSugarResult.error) throw new Error(`Unable to load v_blood_sugar_logs_detailed: ${bloodSugarResult.error.message}`);
  if (membersResult.error) throw new Error(`Unable to load active members for health dashboard: ${membersResult.error.message}`);

  const members = (membersResult.data ?? []) as Array<{ id: string; display_name: string; status: "active"; code_status: string | null }>;
  const memberIds = members.map((member) => member.id);
  const [mccResult, mhpResult] = memberIds.length
    ? await Promise.all([
        supabase
          .from("member_command_centers")
          .select("member_id, food_allergies, medication_allergies, environmental_allergies, diet_type, dietary_preferences_restrictions, code_status, command_center_notes")
          .in("member_id", memberIds),
        supabase
          .from("member_health_profiles")
          .select("member_id, important_alerts, diet_type, dietary_restrictions, code_status, cognitive_behavior_comments")
          .in("member_id", memberIds)
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (mccResult.error) throw new Error(mccResult.error.message);
  if (mhpResult.error) throw new Error(mhpResult.error.message);

  const marRows = marSnapshot.today.map((row) => ({
    id: row.marScheduleId,
    member_name: row.memberName,
    medication_name: row.medicationName,
    due_at: row.scheduledTime,
    administered_at: row.administeredAt,
    nurse_name: row.administeredBy,
    status: row.status === "Given" ? "administered" : row.status === "Not Given" ? "not_given" : "scheduled"
  })) satisfies DashboardMarRow[];
  const bloodSugarRows = (bloodSugarResult.data ?? []) as DashboardBloodSugarRow[];

  const now = new Date();
  const fourHoursAhead = new Date(now.getTime() + 4 * 60 * 60 * 1000);
  const dueMedicationRows = marRows
    .filter((row) => row.status === "scheduled")
    .filter((row) => {
      const dueAt = parseDate(row.due_at);
      return Boolean(dueAt && dueAt <= fourHoursAhead);
    })
    .sort((left, right) => left.due_at.localeCompare(right.due_at));
  const overdueMedicationRows = dueMedicationRows.filter((row) => {
    const dueAt = parseDate(row.due_at);
    return Boolean(dueAt && dueAt < now);
  });

  const recentHealthDocs = [
    ...bloodSugarRows.slice(0, 8).map((row) => ({
      id: `bg-${row.id}`,
      when: row.checked_at,
      memberName: row.member_name,
      source: "Blood Sugar",
      detail: `${row.reading_mg_dl} mg/dL`
    })),
    ...marRows
      .filter((row) => Boolean(row.administered_at))
      .slice(0, 8)
      .map((row) => ({
        id: `mar-${row.id}`,
        when: row.administered_at as string,
        memberName: row.member_name,
        source: "MAR",
        detail: row.medication_name
      }))
  ].sort((left, right) => (left.when < right.when ? 1 : -1));

  const mccByMember = new Map(((mccResult.data ?? []) as Array<Record<string, string | null>>).map((row) => [String(row.member_id), row] as const));
  const mhpByMember = new Map(((mhpResult.data ?? []) as Array<Record<string, string | null>>).map((row) => [String(row.member_id), row] as const));
  const careAlerts = members
    .map((member) => {
      const mcc = mccByMember.get(member.id);
      const mhp = mhpByMember.get(member.id);
      const flags: string[] = [];
      const allergyText = `${mcc?.food_allergies ?? ""} ${mcc?.medication_allergies ?? ""} ${mcc?.environmental_allergies ?? ""}`.trim();
      const dietType = `${mcc?.diet_type ?? mhp?.diet_type ?? ""}`.trim().toLowerCase();
      const dietaryRestrictions = `${mcc?.dietary_preferences_restrictions ?? ""} ${mhp?.dietary_restrictions ?? ""}`.trim();
      const codeStatus = `${mcc?.code_status ?? mhp?.code_status ?? member.code_status ?? ""}`.trim();
      const importantAlerts = `${mhp?.important_alerts ?? ""}`.trim();
      const commandCenterNotes = `${mcc?.command_center_notes ?? ""}`.trim();
      const behaviorNotes = `${mhp?.cognitive_behavior_comments ?? ""}`.trim();

      if (allergyText.length > 0) flags.push("Allergies");
      if ((dietType && dietType !== "regular") || dietaryRestrictions.length > 0) flags.push("Special diet");
      if (codeStatus === "DNR") flags.push("DNR");
      if (importantAlerts.length > 0 || commandCenterNotes.length > 0) flags.push("Care alert");
      if (behaviorNotes.length > 0) flags.push("Behavior notes");
      return {
        memberId: member.id,
        memberName: member.display_name,
        flags,
        summary: importantAlerts || commandCenterNotes || dietaryRestrictions || behaviorNotes || "-"
      };
    })
    .filter((row) => row.flags.length > 0)
    .sort((left, right) => left.memberName.localeCompare(right.memberName, undefined, { sensitivity: "base" }))
    .slice(0, 12);

  return {
    marRows,
    bloodSugarRows,
    dueMedicationRows,
    overdueMedicationRows,
    recentHealthDocs,
    careAlerts,
    members: members.map((member) => ({ id: member.id, display_name: member.display_name })),
    carePlans
  };
}
