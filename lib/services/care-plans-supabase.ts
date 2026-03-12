import { createClient } from "@/lib/supabase/server";
import { toEasternDate, toEasternISO } from "@/lib/timezone";

export type CarePlanTrack = "Track 1" | "Track 2" | "Track 3";

export const CARE_PLAN_SECTION_TYPES = [
  "Activities of Daily Living (ADLs) Assistance",
  "Cognitive & Memory Support",
  "Socialization & Emotional Well-Being",
  "Safety & Fall Prevention",
  "Medical & Medication Management"
] as const;

export type CarePlanSectionType = (typeof CARE_PLAN_SECTION_TYPES)[number];
export const CARE_PLAN_SHORT_TERM_LABEL = "Short-Term Goals (within 60 days)";
export const CARE_PLAN_LONG_TERM_LABEL = "Long-Term Goals (within 6 months)";
export type CarePlanStatus = "Due Soon" | "Due Now" | "Overdue" | "Completed";

export interface CarePlan {
  id: string;
  memberId: string;
  memberName: string;
  track: CarePlanTrack;
  enrollmentDate: string;
  reviewDate: string;
  lastCompletedDate: string | null;
  nextDueDate: string;
  status: CarePlanStatus;
  completedBy: string | null;
  dateOfCompletion: string | null;
  responsiblePartySignature: string | null;
  responsiblePartySignatureDate: string | null;
  administratorSignature: string | null;
  administratorSignatureDate: string | null;
  careTeamNotes: string;
  noChangesNeeded: boolean;
  modificationsRequired: boolean;
  modificationsDescription: string;
  createdAt: string;
  updatedAt: string;
}

export interface CarePlanSection {
  id: string;
  carePlanId: string;
  sectionType: CarePlanSectionType;
  shortTermGoals: string;
  longTermGoals: string;
  displayOrder: number;
}

export interface CarePlanTemplate {
  id: string;
  track: CarePlanTrack;
  sectionType: CarePlanSectionType;
  defaultShortTermGoals: string;
  defaultLongTermGoals: string;
}

export interface CarePlanReviewHistory {
  id: string;
  carePlanId: string;
  reviewDate: string;
  reviewedBy: string;
  summary: string;
  changesMade: boolean;
  nextDueDate: string;
  versionId?: string | null;
}

export interface CarePlanVersion {
  id: string;
  carePlanId: string;
  versionNumber: number;
  snapshotType: "initial" | "review";
  snapshotDate: string;
  reviewedBy: string | null;
  status: CarePlanStatus;
  nextDueDate: string;
  noChangesNeeded: boolean;
  modificationsRequired: boolean;
  modificationsDescription: string;
  careTeamNotes: string;
  sections: Array<{
    sectionType: CarePlanSectionType;
    shortTermGoals: string;
    longTermGoals: string;
    displayOrder: number;
  }>;
  createdAt: string;
}

export interface CarePlanListRow {
  id: string;
  memberId: string;
  memberName: string;
  track: CarePlanTrack;
  enrollmentDate: string;
  reviewDate: string;
  lastCompletedDate: string | null;
  nextDueDate: string;
  status: CarePlanStatus;
  completedBy: string | null;
  hasExistingPlan: boolean;
  actionHref: string;
  openHref: string;
}

export interface MemberCarePlanSummary {
  hasExistingPlan: boolean;
  nextDueDate: string | null;
  status: CarePlanStatus | null;
  actionHref: string;
  actionLabel: "New Care Plan" | "Review Care Plan";
  planId: string | null;
}

export interface CarePlanParticipationSummary {
  attendanceDays: number;
  participationDays: number;
  participationRate: number | null;
  windowStartDate: string;
  windowEndDate: string;
}

type DbCarePlan = {
  id: string;
  member_id: string;
  track: CarePlanTrack;
  enrollment_date: string;
  review_date: string;
  last_completed_date: string | null;
  next_due_date: string;
  status: CarePlanStatus;
  completed_by: string | null;
  date_of_completion: string | null;
  responsible_party_signature: string | null;
  responsible_party_signature_date: string | null;
  administrator_signature: string | null;
  administrator_signature_date: string | null;
  care_team_notes: string | null;
  no_changes_needed: boolean;
  modifications_required: boolean;
  modifications_description: string | null;
  created_at: string;
  updated_at: string;
  member: { display_name: string } | null;
};

type DbCarePlanVersion = {
  id: string;
  care_plan_id: string;
  version_number: number;
  snapshot_type: "initial" | "review";
  snapshot_date: string;
  reviewed_by: string | null;
  status: CarePlanStatus;
  next_due_date: string;
  no_changes_needed: boolean;
  modifications_required: boolean;
  modifications_description: string | null;
  care_team_notes: string | null;
  sections_snapshot: Array<{
    sectionType?: string;
    shortTermGoals?: string;
    longTermGoals?: string;
    displayOrder?: number;
  }> | null;
  created_at: string;
};

const GOAL_PREFIX_PATTERN = /^\s*(?:\d+[\.\)]|[-*])\s+/;

function normalizeSectionType(value: string): CarePlanSectionType {
  return CARE_PLAN_SECTION_TYPES.find((candidate) => candidate === value) ?? CARE_PLAN_SECTION_TYPES[0];
}

function splitGoalLines(input: string) {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(GOAL_PREFIX_PATTERN, "").trim())
    .filter(Boolean);
}

export function normalizeGoalList(input: string) {
  const lines = splitGoalLines(input);
  return lines.map((line, idx) => `${idx + 1}. ${line}`).join("\n");
}

export function getGoalListItems(input: string) {
  return splitGoalLines(input);
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysUntil(date: string) {
  const today = new Date(`${toEasternDate()}T00:00:00.000Z`);
  const target = new Date(`${date}T00:00:00.000Z`);
  return Math.floor((target.getTime() - today.getTime()) / 86400000);
}

export function computeCarePlanStatus(nextDueDate: string): CarePlanStatus {
  const delta = daysUntil(nextDueDate);
  if (delta < 0) return "Overdue";
  if (delta === 0) return "Due Now";
  if (delta <= 14) return "Due Soon";
  return "Completed";
}

export function computeInitialDueDate(enrollmentDate: string) {
  return addDays(enrollmentDate, 30);
}

export function computeNextReviewDueDate(lastReviewDate: string) {
  return addDays(lastReviewDate, 180);
}

function toCarePlan(row: DbCarePlan): CarePlan {
  return {
    id: row.id,
    memberId: row.member_id,
    memberName: row.member?.display_name ?? "Unknown Member",
    track: row.track,
    enrollmentDate: row.enrollment_date,
    reviewDate: row.review_date,
    lastCompletedDate: row.last_completed_date,
    nextDueDate: row.next_due_date,
    status: computeCarePlanStatus(row.next_due_date),
    completedBy: row.completed_by,
    dateOfCompletion: row.date_of_completion,
    responsiblePartySignature: row.responsible_party_signature,
    responsiblePartySignatureDate: row.responsible_party_signature_date,
    administratorSignature: row.administrator_signature,
    administratorSignatureDate: row.administrator_signature_date,
    careTeamNotes: row.care_team_notes ?? "",
    noChangesNeeded: row.no_changes_needed,
    modificationsRequired: row.modifications_required,
    modificationsDescription: row.modifications_description ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toCarePlanVersion(row: DbCarePlanVersion): CarePlanVersion {
  return {
    id: row.id,
    carePlanId: row.care_plan_id,
    versionNumber: row.version_number,
    snapshotType: row.snapshot_type,
    snapshotDate: row.snapshot_date,
    reviewedBy: row.reviewed_by,
    status: row.status,
    nextDueDate: row.next_due_date,
    noChangesNeeded: Boolean(row.no_changes_needed),
    modificationsRequired: Boolean(row.modifications_required),
    modificationsDescription: row.modifications_description ?? "",
    careTeamNotes: row.care_team_notes ?? "",
    sections: (row.sections_snapshot ?? []).map((section) => ({
      sectionType: normalizeSectionType(String(section.sectionType ?? "")),
      shortTermGoals: normalizeGoalList(String(section.shortTermGoals ?? "")),
      longTermGoals: normalizeGoalList(String(section.longTermGoals ?? "")),
      displayOrder: Number(section.displayOrder ?? 1)
    })),
    createdAt: row.created_at
  };
}

function applyCurrentVersionToCarePlan(plan: CarePlan, currentVersion: CarePlanVersion | null) {
  if (!currentVersion) return plan;
  return {
    ...plan,
    reviewDate: currentVersion.snapshotDate,
    lastCompletedDate: currentVersion.snapshotDate,
    nextDueDate: currentVersion.nextDueDate,
    status: currentVersion.status,
    completedBy: currentVersion.reviewedBy,
    dateOfCompletion: currentVersion.snapshotDate,
    careTeamNotes: currentVersion.careTeamNotes,
    noChangesNeeded: currentVersion.noChangesNeeded,
    modificationsRequired: currentVersion.modificationsRequired,
    modificationsDescription: currentVersion.modificationsDescription
  } satisfies CarePlan;
}

async function getLatestCarePlanVersionMap(carePlanIds: string[]) {
  if (carePlanIds.length === 0) return new Map<string, CarePlanVersion>();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("care_plan_versions")
    .select("*")
    .in("care_plan_id", carePlanIds)
    .order("care_plan_id", { ascending: true })
    .order("version_number", { ascending: false });
  if (error) throw new Error(error.message);
  const latestByPlan = new Map<string, CarePlanVersion>();
  ((data ?? []) as DbCarePlanVersion[]).forEach((row) => {
    if (latestByPlan.has(row.care_plan_id)) return;
    latestByPlan.set(row.care_plan_id, toCarePlanVersion(row));
  });
  return latestByPlan;
}

function defaultGoalsForSection(track: CarePlanTrack, sectionType: CarePlanSectionType) {
  const intensity = track === "Track 1" ? "minimal cueing" : track === "Track 2" ? "structured prompts" : "hands-on support";
  return {
    short: normalizeGoalList(`${sectionType}: member participates with ${intensity}.\nTeam documents weekly progress.`),
    long: normalizeGoalList(`${sectionType}: maintain or improve baseline function.\nUpdate interventions each review cycle.`)
  };
}

const templates: CarePlanTemplate[] = (["Track 1", "Track 2", "Track 3"] as CarePlanTrack[]).flatMap((track) =>
  CARE_PLAN_SECTION_TYPES.map((sectionType, index) => {
    const goals = defaultGoalsForSection(track, sectionType);
    return {
      id: `tpl-${track.toLowerCase().replace(/\s+/g, "-")}-${index + 1}`,
      track,
      sectionType,
      defaultShortTermGoals: goals.short,
      defaultLongTermGoals: goals.long
    };
  })
);

export function getCarePlanTemplates(track?: CarePlanTrack) {
  return templates.filter((template) => (track ? template.track === track : true));
}

export function getCarePlanTracks(): CarePlanTrack[] {
  return ["Track 1", "Track 2", "Track 3"];
}

function serializeSectionsSnapshot(
  sections: Array<{
    sectionType: CarePlanSectionType;
    shortTermGoals: string;
    longTermGoals: string;
    displayOrder: number;
  }>
) {
  return sections.map((section) => ({
    sectionType: normalizeSectionType(section.sectionType),
    shortTermGoals: normalizeGoalList(section.shortTermGoals),
    longTermGoals: normalizeGoalList(section.longTermGoals),
    displayOrder: Number(section.displayOrder)
  }));
}

async function getNextCarePlanVersionNumber(carePlanId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("care_plan_versions")
    .select("version_number")
    .eq("care_plan_id", carePlanId)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const current = Number(data?.version_number ?? 0);
  return Number.isFinite(current) && current > 0 ? current + 1 : 1;
}

async function createCarePlanVersionSnapshot(input: {
  carePlanId: string;
  snapshotType: "initial" | "review";
  snapshotDate: string;
  reviewedBy: string | null;
  status: CarePlanStatus;
  nextDueDate: string;
  noChangesNeeded: boolean;
  modificationsRequired: boolean;
  modificationsDescription: string;
  careTeamNotes: string;
  sections: Array<{
    sectionType: CarePlanSectionType;
    shortTermGoals: string;
    longTermGoals: string;
    displayOrder: number;
  }>;
}) {
  const supabase = await createClient();
  const versionNumber = await getNextCarePlanVersionNumber(input.carePlanId);
  const { data, error } = await supabase
    .from("care_plan_versions")
    .insert({
      care_plan_id: input.carePlanId,
      version_number: versionNumber,
      snapshot_type: input.snapshotType,
      snapshot_date: input.snapshotDate,
      reviewed_by: input.reviewedBy,
      status: input.status,
      next_due_date: input.nextDueDate,
      no_changes_needed: input.noChangesNeeded,
      modifications_required: input.modificationsRequired,
      modifications_description: input.modificationsDescription,
      care_team_notes: input.careTeamNotes,
      sections_snapshot: serializeSectionsSnapshot(input.sections),
      created_at: toEasternISO()
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { versionId: String(data.id), versionNumber };
}

export async function getCarePlanParticipationSummary(memberId: string): Promise<CarePlanParticipationSummary> {
  const supabase = await createClient();
  const windowEndDate = toEasternDate();
  const windowStartDate = addDays(windowEndDate, -180);
  const [{ data: attendanceRows, error: attendanceError }, { data: activityRows, error: activityError }] = await Promise.all([
    supabase.from("attendance_records").select("attendance_date").eq("member_id", memberId).gte("attendance_date", windowStartDate).lte("attendance_date", windowEndDate),
    supabase.from("daily_activity_logs").select("activity_date").eq("member_id", memberId).gte("activity_date", windowStartDate).lte("activity_date", windowEndDate)
  ]);
  if (attendanceError) throw new Error(attendanceError.message);
  if (activityError) throw new Error(activityError.message);
  const attendanceDays = (attendanceRows ?? []).length;
  const participationDays = new Set((activityRows ?? []).map((row: any) => String(row.activity_date).slice(0, 10))).size;
  return {
    attendanceDays,
    participationDays,
    participationRate: attendanceDays === 0 ? null : Math.round((participationDays / attendanceDays) * 100),
    windowStartDate,
    windowEndDate
  };
}

export async function getCarePlans(filters?: { memberId?: string; track?: string; status?: string; query?: string }): Promise<CarePlanListRow[]> {
  const supabase = await createClient();
  let query = supabase.from("care_plans").select("*, member:members!care_plans_member_id_fkey(display_name)").order("next_due_date", { ascending: true });
  if (filters?.memberId) query = query.eq("member_id", filters.memberId);
  if (filters?.track && filters.track !== "All") query = query.eq("track", filters.track);
  const { data: plans, error } = await query;
  if (error) throw new Error(error.message);

  const planRows = (plans ?? []) as DbCarePlan[];
  const latestVersionByPlan = await getLatestCarePlanVersionMap(planRows.map((row) => row.id));

  const rows: CarePlanListRow[] = planRows.map((row) => {
    const basePlan = toCarePlan(row);
    const plan = applyCurrentVersionToCarePlan(basePlan, latestVersionByPlan.get(basePlan.id) ?? null);
    return {
      id: plan.id,
      memberId: plan.memberId,
      memberName: plan.memberName,
      track: plan.track,
      enrollmentDate: plan.enrollmentDate,
      reviewDate: plan.reviewDate,
      lastCompletedDate: plan.lastCompletedDate,
      nextDueDate: plan.nextDueDate,
      status: plan.status,
      completedBy: plan.completedBy,
      hasExistingPlan: true,
      actionHref: `/health/care-plans/${plan.id}?view=review`,
      openHref: `/health/care-plans/${plan.id}`
    };
  });

  return rows
    .filter((row) => (filters?.status && filters.status !== "All" ? row.status === filters.status : true))
    .filter((row) => (filters?.query ? `${row.memberName} ${row.track}`.toLowerCase().includes(filters.query.toLowerCase()) : true));
}

export async function getCarePlanById(id: string) {
  const supabase = await createClient();
  const [{ data: plan, error: planError }, { data: sections, error: sectionError }, { data: history, error: historyError }, { data: versions, error: versionsError }] =
    await Promise.all([
      supabase.from("care_plans").select("*, member:members!care_plans_member_id_fkey(display_name)").eq("id", id).maybeSingle(),
      supabase.from("care_plan_sections").select("*").eq("care_plan_id", id).order("display_order", { ascending: true }),
      supabase.from("care_plan_review_history").select("*").eq("care_plan_id", id).order("review_date", { ascending: false }),
      supabase.from("care_plan_versions").select("*").eq("care_plan_id", id).order("version_number", { ascending: false })
    ]);
  if (planError) throw new Error(planError.message);
  if (sectionError) throw new Error(sectionError.message);
  if (historyError) throw new Error(historyError.message);
  if (versionsError) throw new Error(versionsError.message);
  if (!plan) return null;
  const mappedVersions = ((versions ?? []) as DbCarePlanVersion[]).map((row) => toCarePlanVersion(row));
  const carePlan = applyCurrentVersionToCarePlan(toCarePlan(plan as DbCarePlan), mappedVersions[0] ?? null);
  return {
    carePlan,
    sections: (sections ?? []).map((row: any) => ({ id: row.id, carePlanId: row.care_plan_id, sectionType: normalizeSectionType(row.section_type), shortTermGoals: normalizeGoalList(row.short_term_goals), longTermGoals: normalizeGoalList(row.long_term_goals), displayOrder: row.display_order } satisfies CarePlanSection)),
    history: (history ?? []).map((row: any) => ({ id: row.id, carePlanId: row.care_plan_id, reviewDate: row.review_date, reviewedBy: row.reviewed_by, summary: row.summary, changesMade: Boolean(row.changes_made), nextDueDate: row.next_due_date, versionId: row.version_id ?? null } satisfies CarePlanReviewHistory)),
    versions: mappedVersions,
    participationSummary: await getCarePlanParticipationSummary(carePlan.memberId)
  };
}

export async function getCarePlanDashboard() {
  const plans = await getCarePlans();
  const dueSoon = plans.filter((row) => row.status === "Due Soon");
  const dueNow = plans.filter((row) => row.status === "Due Now");
  const overdue = plans.filter((row) => row.status === "Overdue");
  return {
    summary: { total: plans.length, dueSoon: dueSoon.length, dueNow: dueNow.length, overdue: overdue.length, completedRecently: 0 },
    dueSoon,
    dueNow,
    overdue,
    recentlyCompleted: [] as Array<CarePlanReviewHistory & { memberId: string; memberName: string; track: CarePlanTrack }>,
    plans
  };
}

export async function getCarePlansForMember(memberId: string) {
  const rows = await getCarePlans({ memberId });
  return rows.map((row) => ({
    id: row.id,
    memberId: row.memberId,
    memberName: row.memberName,
    track: row.track,
    enrollmentDate: row.enrollmentDate,
    reviewDate: row.reviewDate,
    lastCompletedDate: row.lastCompletedDate,
    nextDueDate: row.nextDueDate,
    status: row.status,
    completedBy: row.completedBy,
    dateOfCompletion: row.lastCompletedDate,
    responsiblePartySignature: null,
    responsiblePartySignatureDate: null,
    administratorSignature: null,
    administratorSignatureDate: null,
    careTeamNotes: "",
    noChangesNeeded: false,
    modificationsRequired: false,
    modificationsDescription: "",
    createdAt: "",
    updatedAt: ""
  })) as CarePlan[];
}

export async function getLatestCarePlanForMember(memberId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("care_plans")
    .select("*, member:members!care_plans_member_id_fkey(display_name)")
    .eq("member_id", memberId)
    .order("review_date", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const basePlan = toCarePlan(data as DbCarePlan);
  const latestVersionByPlan = await getLatestCarePlanVersionMap([basePlan.id]);
  return applyCurrentVersionToCarePlan(basePlan, latestVersionByPlan.get(basePlan.id) ?? null);
}

export async function getMemberCarePlanSummary(memberId: string): Promise<MemberCarePlanSummary> {
  const latest = await getLatestCarePlanForMember(memberId);
  if (latest) return { hasExistingPlan: true, nextDueDate: latest.nextDueDate, status: latest.status, actionHref: `/health/care-plans/${latest.id}?view=review`, actionLabel: "Review Care Plan", planId: latest.id };
  return { hasExistingPlan: false, nextDueDate: null, status: null, actionHref: `/health/care-plans/new?memberId=${memberId}`, actionLabel: "New Care Plan", planId: null };
}

export async function getCarePlanVersionById(carePlanId: string, versionId: string) {
  const supabase = await createClient();
  const [{ data: plan, error: planError }, { data: version, error: versionError }] = await Promise.all([
    supabase.from("care_plans").select("*, member:members!care_plans_member_id_fkey(display_name)").eq("id", carePlanId).maybeSingle(),
    supabase.from("care_plan_versions").select("*").eq("care_plan_id", carePlanId).eq("id", versionId).maybeSingle()
  ]);
  if (planError) throw new Error(planError.message);
  if (versionError) throw new Error(versionError.message);
  if (!plan || !version) return null;
  const mappedVersion = toCarePlanVersion(version as DbCarePlanVersion);
  return {
    carePlan: applyCurrentVersionToCarePlan(toCarePlan(plan as DbCarePlan), mappedVersion),
    version: mappedVersion
  };
}

export async function createCarePlan(input: {
  memberId: string;
  track: CarePlanTrack;
  enrollmentDate: string;
  reviewDate: string;
  careTeamNotes: string;
  noChangesNeeded?: boolean;
  modificationsRequired?: boolean;
  modificationsDescription?: string;
  completedBy?: string;
  dateOfCompletion?: string;
  responsiblePartySignature?: string;
  responsiblePartySignatureDate?: string;
  administratorSignature?: string;
  administratorSignatureDate?: string;
  sections: Array<{ sectionType: CarePlanSectionType; shortTermGoals: string; longTermGoals: string; displayOrder: number }>;
}) {
  const supabase = await createClient();
  const nextDueDate = input.dateOfCompletion ? computeNextReviewDueDate(input.dateOfCompletion) : computeInitialDueDate(input.enrollmentDate);
  const { data, error } = await supabase.from("care_plans").insert({
    member_id: input.memberId,
    track: input.track,
    enrollment_date: input.enrollmentDate,
    review_date: input.reviewDate,
    last_completed_date: input.dateOfCompletion ?? null,
    next_due_date: nextDueDate,
    status: computeCarePlanStatus(nextDueDate),
    completed_by: input.completedBy ?? null,
    date_of_completion: input.dateOfCompletion ?? null,
    responsible_party_signature: input.responsiblePartySignature ?? null,
    responsible_party_signature_date: input.responsiblePartySignatureDate ?? null,
    administrator_signature: input.administratorSignature ?? null,
    administrator_signature_date: input.administratorSignatureDate ?? null,
    care_team_notes: input.careTeamNotes,
    no_changes_needed: Boolean(input.noChangesNeeded),
    modifications_required: Boolean(input.modificationsRequired),
    modifications_description: input.modificationsDescription ?? "",
    created_by_name: input.completedBy ?? null,
    updated_by_name: input.completedBy ?? null,
    created_at: toEasternISO(),
    updated_at: toEasternISO()
  }).select("*, member:members!care_plans_member_id_fkey(display_name)").single();
  if (error) throw new Error(error.message);
  const { error: sectionsError } = await supabase.from("care_plan_sections").insert(input.sections.map((section) => ({ care_plan_id: data.id, section_type: section.sectionType, short_term_goals: normalizeGoalList(section.shortTermGoals), long_term_goals: normalizeGoalList(section.longTermGoals), display_order: section.displayOrder, created_at: toEasternISO(), updated_at: toEasternISO() })));
  if (sectionsError) throw new Error(sectionsError.message);
  await createCarePlanVersionSnapshot({
    carePlanId: data.id,
    snapshotType: "initial",
    snapshotDate: input.reviewDate,
    reviewedBy: input.completedBy ?? null,
    status: computeCarePlanStatus(nextDueDate),
    nextDueDate,
    noChangesNeeded: Boolean(input.noChangesNeeded),
    modificationsRequired: Boolean(input.modificationsRequired),
    modificationsDescription: input.modificationsDescription ?? "",
    careTeamNotes: input.careTeamNotes,
    sections: input.sections
  });
  return toCarePlan(data as DbCarePlan);
}

export async function reviewCarePlan(input: {
  carePlanId: string;
  reviewDate: string;
  reviewedBy: string;
  noChangesNeeded: boolean;
  modificationsRequired: boolean;
  modificationsDescription: string;
  careTeamNotes: string;
  sections: Array<{ id: string; shortTermGoals: string; longTermGoals: string }>;
  responsiblePartySignature?: string;
  responsiblePartySignatureDate?: string;
  administratorSignature?: string;
  administratorSignatureDate?: string;
}) {
  const supabase = await createClient();
  const updatedSectionsSnapshot: Array<{
    sectionType: CarePlanSectionType;
    shortTermGoals: string;
    longTermGoals: string;
    displayOrder: number;
  }> = [];
  for (const section of input.sections) {
    const { data: updatedSection, error: sectionLookupError } = await supabase
      .from("care_plan_sections")
      .select("id, section_type, display_order")
      .eq("id", section.id)
      .eq("care_plan_id", input.carePlanId)
      .maybeSingle();
    if (sectionLookupError) throw new Error(sectionLookupError.message);
    if (!updatedSection) throw new Error("Care plan section not found.");
    const { error } = await supabase.from("care_plan_sections").update({ short_term_goals: normalizeGoalList(section.shortTermGoals), long_term_goals: normalizeGoalList(section.longTermGoals), updated_at: toEasternISO() }).eq("id", section.id).eq("care_plan_id", input.carePlanId);
    if (error) throw new Error(error.message);
    updatedSectionsSnapshot.push({
      sectionType: normalizeSectionType(String(updatedSection.section_type ?? "")),
      shortTermGoals: section.shortTermGoals,
      longTermGoals: section.longTermGoals,
      displayOrder: Number(updatedSection.display_order ?? 1)
    });
  }
  const nextDueDate = computeNextReviewDueDate(input.reviewDate);
  const { data, error } = await supabase.from("care_plans").update({
    review_date: input.reviewDate,
    last_completed_date: input.reviewDate,
    next_due_date: nextDueDate,
    status: computeCarePlanStatus(nextDueDate),
    completed_by: input.reviewedBy,
    date_of_completion: input.reviewDate,
    no_changes_needed: input.noChangesNeeded,
    modifications_required: input.modificationsRequired,
    modifications_description: input.modificationsDescription,
    care_team_notes: input.careTeamNotes,
    responsible_party_signature: input.responsiblePartySignature ?? null,
    responsible_party_signature_date: input.responsiblePartySignatureDate ?? null,
    administrator_signature: input.administratorSignature ?? null,
    administrator_signature_date: input.administratorSignatureDate ?? null,
    updated_by_name: input.reviewedBy,
    updated_at: toEasternISO()
  }).eq("id", input.carePlanId).select("*, member:members!care_plans_member_id_fkey(display_name)").single();
  if (error) throw new Error(error.message);
  const snapshot = await createCarePlanVersionSnapshot({
    carePlanId: input.carePlanId,
    snapshotType: "review",
    snapshotDate: input.reviewDate,
    reviewedBy: input.reviewedBy,
    status: computeCarePlanStatus(nextDueDate),
    nextDueDate,
    noChangesNeeded: input.noChangesNeeded,
    modificationsRequired: input.modificationsRequired,
    modificationsDescription: input.modificationsDescription,
    careTeamNotes: input.careTeamNotes,
    sections: updatedSectionsSnapshot
  });
  const { error: historyError } = await supabase.from("care_plan_review_history").insert({
    care_plan_id: input.carePlanId,
    review_date: input.reviewDate,
    reviewed_by: input.reviewedBy,
    summary: input.modificationsRequired
      ? input.modificationsDescription || "Reviewed with modifications."
      : "Reviewed without required modifications.",
    changes_made: input.modificationsRequired,
    next_due_date: nextDueDate,
    version_id: snapshot.versionId,
    created_at: toEasternISO()
  });
  if (historyError) throw new Error(historyError.message);
  return toCarePlan(data as DbCarePlan);
}
