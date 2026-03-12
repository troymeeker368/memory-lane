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

  const rows: CarePlanListRow[] = ((plans ?? []) as DbCarePlan[]).map((row) => {
    const plan = toCarePlan(row);
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
  const carePlan = toCarePlan(plan as DbCarePlan);
  return {
    carePlan,
    sections: (sections ?? []).map((row: any) => ({ id: row.id, carePlanId: row.care_plan_id, sectionType: normalizeSectionType(row.section_type), shortTermGoals: normalizeGoalList(row.short_term_goals), longTermGoals: normalizeGoalList(row.long_term_goals), displayOrder: row.display_order } satisfies CarePlanSection)),
    history: (history ?? []).map((row: any) => ({ id: row.id, carePlanId: row.care_plan_id, reviewDate: row.review_date, reviewedBy: row.reviewed_by, summary: row.summary, changesMade: Boolean(row.changes_made), nextDueDate: row.next_due_date, versionId: row.version_id ?? null } satisfies CarePlanReviewHistory)),
    versions: (versions ?? []).map((row: any) => ({ id: row.id, carePlanId: row.care_plan_id, versionNumber: row.version_number, snapshotType: row.snapshot_type, snapshotDate: row.snapshot_date, reviewedBy: row.reviewed_by, status: row.status, nextDueDate: row.next_due_date, noChangesNeeded: Boolean(row.no_changes_needed), modificationsRequired: Boolean(row.modifications_required), modificationsDescription: row.modifications_description ?? "", careTeamNotes: row.care_team_notes ?? "", sections: (row.sections_snapshot ?? []).map((section: any) => ({ sectionType: normalizeSectionType(section.sectionType), shortTermGoals: normalizeGoalList(String(section.shortTermGoals ?? "")), longTermGoals: normalizeGoalList(String(section.longTermGoals ?? "")), displayOrder: Number(section.displayOrder ?? 1) })), createdAt: row.created_at } satisfies CarePlanVersion)),
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
  const { data, error } = await supabase.from("care_plans").select("*, member:members!care_plans_member_id_fkey(display_name)").eq("member_id", memberId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toCarePlan(data as DbCarePlan) : null;
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
  return { carePlan: toCarePlan(plan as DbCarePlan), version: { id: version.id, carePlanId: version.care_plan_id, versionNumber: version.version_number, snapshotType: version.snapshot_type, snapshotDate: version.snapshot_date, reviewedBy: version.reviewed_by, status: version.status, nextDueDate: version.next_due_date, noChangesNeeded: Boolean(version.no_changes_needed), modificationsRequired: Boolean(version.modifications_required), modificationsDescription: version.modifications_description ?? "", careTeamNotes: version.care_team_notes ?? "", sections: (version.sections_snapshot ?? []), createdAt: version.created_at } as CarePlanVersion };
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
  for (const section of input.sections) {
    const { error } = await supabase.from("care_plan_sections").update({ short_term_goals: normalizeGoalList(section.shortTermGoals), long_term_goals: normalizeGoalList(section.longTermGoals), updated_at: toEasternISO() }).eq("id", section.id).eq("care_plan_id", input.carePlanId);
    if (error) throw new Error(error.message);
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
  return toCarePlan(data as DbCarePlan);
}
