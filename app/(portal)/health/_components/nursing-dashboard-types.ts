import type { getHealthDashboardData } from "@/lib/services/health-dashboard";

export type HealthDashboardSnapshot = Awaited<ReturnType<typeof getHealthDashboardData>>;

export type HealthDashboardTab =
  | "overview"
  | "documentation"
  | "mar"
  | "incidents"
  | "quick-entry"
  | "alerts";

export type DashboardDueStatus = "all" | "overdue" | "due_now" | "due_soon" | "open";
export type DashboardDocumentationType = "all" | "progress_note" | "care_plan";
export type DashboardRiskFilter = "all" | "high" | "standard";
export type DashboardTimeframe = "today" | "next_7_days" | "all";

export type QueueTone = "default" | "warning" | "danger" | "success";
export type QueuePriority = "urgent" | "today" | "soon" | "routine";

export type NursingDashboardCapabilities = {
  canViewCarePlans: boolean;
  canViewIncidents: boolean;
  canViewProgressNotes: boolean;
};

export type QueueItem = {
  id: string;
  kind: "medication" | "progress_note" | "care_plan" | "incident" | "alert" | "recent_doc";
  tab: Exclude<HealthDashboardTab, "overview" | "quick-entry">;
  memberId: string | null;
  memberName: string;
  title: string;
  subtitle: string;
  statusLabel: string;
  tone: QueueTone;
  priority: QueuePriority;
  dueAt: string | null;
  dueText: string | null;
  meta: string[];
  tags: string[];
  primaryHref: string;
  primaryActionLabel: string;
  secondaryHref?: string | null;
  secondaryActionLabel?: string | null;
};
