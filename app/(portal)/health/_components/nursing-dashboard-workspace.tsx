"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { BloodSugarFormShell } from "@/components/forms/workflow-forms-shells";
import { NursingDashboardFilters } from "@/app/(portal)/health/_components/nursing-dashboard-filters";
import { NursingDashboardQueue } from "@/app/(portal)/health/_components/nursing-dashboard-queue";
import type {
  DashboardDocumentationType,
  DashboardDueStatus,
  DashboardRiskFilter,
  DashboardTimeframe,
  HealthDashboardSnapshot,
  HealthDashboardTab,
  NursingDashboardCapabilities,
  QueueItem,
  QueuePriority,
  QueueTone
} from "@/app/(portal)/health/_components/nursing-dashboard-types";
import { getProgressNoteComplianceLabel } from "@/lib/services/progress-note-model";
import { formatDate, formatDateTime, formatOptionalDate } from "@/lib/utils";

const PRIORITY_ORDER: Record<QueuePriority, number> = {
  urgent: 0,
  today: 1,
  soon: 2,
  routine: 3
};

function normalizeText(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function asDate(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function describeDueDay(value: string | null) {
  const dueAt = asDate(value);
  if (!dueAt) return "Review details";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDueDate = new Date(dueAt.getFullYear(), dueAt.getMonth(), dueAt.getDate());
  const dayDelta = Math.round((startOfDueDate.getTime() - startOfToday.getTime()) / (24 * 60 * 60 * 1000));
  if (dayDelta < 0) return `${Math.abs(dayDelta)}d overdue`;
  if (dayDelta === 0) return "Due today";
  if (dayDelta === 1) return "Due tomorrow";
  return `Due in ${dayDelta}d`;
}

function sortQueueItems(items: QueueItem[]) {
  return [...items].sort((left, right) => {
    const priorityDelta = PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority];
    if (priorityDelta !== 0) return priorityDelta;
    const leftDue = left.dueAt ?? "";
    const rightDue = right.dueAt ?? "";
    if (leftDue !== rightDue) return leftDue.localeCompare(rightDue);
    return left.title.localeCompare(right.title);
  });
}

function matchesMemberQuery(item: QueueItem, query: string) {
  if (!query) return true;
  const haystack = normalizeText([item.memberName, item.title, item.subtitle, item.meta.join(" "), item.tags.join(" ")].join(" "));
  return haystack.includes(query);
}

function matchesTimeframe(item: QueueItem, timeframe: DashboardTimeframe) {
  if (timeframe === "all" || !item.dueAt) return true;
  const dueAt = asDate(item.dueAt);
  if (!dueAt) return true;
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  if (timeframe === "today") {
    return dueAt <= endOfToday;
  }
  const sevenDaysAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return dueAt <= sevenDaysAhead;
}

function matchesDueStatus(item: QueueItem, dueStatus: DashboardDueStatus) {
  if (dueStatus === "all") return true;
  if (dueStatus === "open") {
    return item.kind === "incident" || item.kind === "alert";
  }
  if (dueStatus === "overdue") return item.priority === "urgent";
  if (dueStatus === "due_now") return item.priority === "today";
  return item.priority === "soon";
}

function matchesDocumentationType(item: QueueItem, documentationType: DashboardDocumentationType) {
  if (documentationType === "all") return true;
  if (documentationType === "progress_note") return item.kind === "progress_note";
  return item.kind === "care_plan";
}

function matchesRiskFilter(item: QueueItem, riskFilter: DashboardRiskFilter) {
  if (item.kind !== "alert") return true;
  const isHighRisk = item.tags.includes("High risk");
  if (riskFilter === "all") return true;
  if (riskFilter === "high") return isHighRisk;
  return !isHighRisk;
}

function formatIncidentStatus(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildMedicationItems(dashboard: HealthDashboardSnapshot): QueueItem[] {
  const overdueIds = new Set(dashboard.overdueMedicationRows.map((row) => row.id));
  const dueNowIds = new Set(dashboard.dueNowMedicationRows.map((row) => row.id));
  const dueSoonIds = new Set(dashboard.dueSoonMedicationRows.map((row) => row.id));

  return sortQueueItems(
    dashboard.dueMedicationRows.map((row) => {
      const isOverdue = overdueIds.has(row.id) || row.status === "not_given";
      const isDueNow = dueNowIds.has(row.id);
      const isDueSoon = dueSoonIds.has(row.id);
      const tone: QueueTone = isOverdue ? "danger" : isDueNow ? "warning" : "default";
      const priority: QueuePriority = isOverdue ? "urgent" : isDueNow ? "today" : isDueSoon ? "soon" : "routine";
      const statusLabel = isOverdue ? "Overdue" : isDueNow ? "Due now" : isDueSoon ? "Due soon" : "Scheduled";
      return {
        id: `med-${row.id}`,
        kind: "medication",
        tab: "mar",
        memberId: row.member_id,
        memberName: row.member_name,
        title: row.medication_name,
        subtitle: row.member_name,
        statusLabel,
        tone,
        priority,
        dueAt: row.due_at,
        dueText: `${statusLabel} | ${formatDateTime(row.due_at)}`,
        meta: [row.nurse_name ? `Last nurse: ${row.nurse_name}` : "Open MAR to document", "Medication / treatment queue"],
        tags: ["Medication", statusLabel],
        primaryHref: "/health/mar",
        primaryActionLabel: "Open MAR",
        secondaryHref: `/health/member-health-profiles/${row.member_id}`,
        secondaryActionLabel: "Member chart"
      } satisfies QueueItem;
    })
  );
}

function buildProgressNoteItems(dashboard: HealthDashboardSnapshot): QueueItem[] {
  return sortQueueItems(
    dashboard.progressNotes.rows.map((row) => {
      const isOverdue = row.complianceStatus === "overdue" || row.complianceStatus === "data_issue";
      const isDueToday = row.complianceStatus === "due";
      const isDueSoon = row.complianceStatus === "due_soon";
      const tone: QueueTone =
        row.complianceStatus === "overdue" ? "danger" : row.complianceStatus === "due" ? "warning" : "default";
      const priority: QueuePriority = isOverdue ? "urgent" : isDueToday ? "today" : isDueSoon ? "soon" : "routine";
      return {
        id: `pn-${row.memberId}`,
        kind: "progress_note",
        tab: "documentation",
        memberId: row.memberId,
        memberName: row.memberName,
        title: row.memberName,
        subtitle: "Progress note documentation",
        statusLabel: getProgressNoteComplianceLabel(row.complianceStatus),
        tone,
        priority,
        dueAt: row.nextProgressNoteDueDate,
        dueText: row.nextProgressNoteDueDate ? `${describeDueDay(row.nextProgressNoteDueDate)} | ${formatDate(row.nextProgressNoteDueDate)}` : "Date issue",
        meta: [
          `Last signed: ${formatOptionalDate(row.lastSignedProgressNoteDate)}`,
          row.latestDraftId ? "Draft in progress" : "No active draft",
          row.dataIssue ?? ""
        ].filter(Boolean),
        tags: ["Progress note", row.complianceStatus, row.latestDraftId ? "Draft" : "Ready"],
        primaryHref: row.latestDraftId ? `/health/progress-notes/${row.latestDraftId}` : `/health/progress-notes/new?memberId=${row.memberId}`,
        primaryActionLabel: row.latestDraftId ? "Resume draft" : "Open note",
        secondaryHref: `/health/member-health-profiles/${row.memberId}`,
        secondaryActionLabel: "Member chart"
      } satisfies QueueItem;
    })
  );
}

function buildCarePlanItems(dashboard: HealthDashboardSnapshot): QueueItem[] {
  return sortQueueItems(
    dashboard.carePlans.plans.map((row) => {
      const tone: QueueTone = row.status === "Overdue" ? "danger" : row.status === "Due Now" ? "warning" : "default";
      const priority: QueuePriority =
        row.status === "Overdue" ? "urgent" : row.status === "Due Now" ? "today" : row.status === "Due Soon" ? "soon" : "routine";
      return {
        id: `cp-${row.id}`,
        kind: "care_plan",
        tab: "documentation",
        memberId: row.memberId,
        memberName: row.memberName,
        title: row.memberName,
        subtitle: `Care plan review | ${row.track}`,
        statusLabel: row.status,
        tone,
        priority,
        dueAt: row.nextDueDate,
        dueText: `${describeDueDay(row.nextDueDate)} | ${formatDate(row.nextDueDate)}`,
        meta: [
          `Review date: ${formatDate(row.reviewDate)}`,
          `Last completed: ${formatOptionalDate(row.lastCompletedDate)}`,
          row.postSignReadinessReason ?? ""
        ].filter(Boolean),
        tags: ["Care plan", row.track, row.status],
        primaryHref: row.actionHref,
        primaryActionLabel: row.hasExistingPlan ? "Review care plan" : "New care plan",
        secondaryHref: row.openHref,
        secondaryActionLabel: "Open record"
      } satisfies QueueItem;
    })
  );
}

function buildIncidentItems(dashboard: HealthDashboardSnapshot): QueueItem[] {
  return sortQueueItems(
    dashboard.incidents.actionable.map((row) => {
      const isUrgent = row.status === "returned" || row.reportable;
      const tone: QueueTone = isUrgent ? "danger" : row.status === "submitted" ? "warning" : "default";
      const priority: QueuePriority = isUrgent ? "urgent" : row.status === "submitted" ? "today" : "routine";
      return {
        id: `incident-${row.id}`,
        kind: "incident",
        tab: "incidents",
        memberId: null,
        memberName: row.participantName ?? row.staffMemberName ?? "General incident",
        title: row.incidentNumber,
        subtitle: `${row.participantName ?? row.staffMemberName ?? "General incident"} | ${row.location}`,
        statusLabel: formatIncidentStatus(row.status),
        tone,
        priority,
        dueAt: row.incidentDateTime,
        dueText: `Occurred ${formatDateTime(row.incidentDateTime)}`,
        meta: [
          row.reportable ? "Reportable event" : "Internal follow-up",
          `Category: ${formatIncidentStatus(row.category)}`,
          `Reporter: ${row.reporterName}`
        ],
        tags: ["Incident", row.reportable ? "Reportable" : "Non-reportable", row.status],
        primaryHref: `/documentation/incidents/${row.id}`,
        primaryActionLabel: "Open incident",
        secondaryHref: "/documentation/incidents",
        secondaryActionLabel: "Incident queue"
      } satisfies QueueItem;
    })
  );
}

function buildAlertItems(dashboard: HealthDashboardSnapshot): QueueItem[] {
  return sortQueueItems(
    dashboard.careAlerts.map((row) => ({
      id: `alert-${row.memberId}`,
      kind: "alert",
      tab: "alerts",
      memberId: row.memberId,
      memberName: row.memberName,
      title: row.memberName,
      subtitle: row.summary,
      statusLabel: row.riskLevel === "high" ? "High risk" : "Alert",
      tone: row.riskLevel === "high" ? "danger" : "default",
      priority: row.riskLevel === "high" ? "urgent" : "routine",
      dueAt: null,
      dueText: row.flags.slice(0, 2).join(" | ") || "Review member chart",
      meta: [row.flags.join(" | "), row.summary].filter(Boolean),
      tags: [...row.flags, row.riskLevel === "high" ? "High risk" : "Standard risk"],
      primaryHref: `/health/member-health-profiles/${row.memberId}`,
      primaryActionLabel: "Open chart",
      secondaryHref: "/health/member-health-profiles",
      secondaryActionLabel: "All profiles"
    }))
  );
}

function buildRecentDocumentationItems(dashboard: HealthDashboardSnapshot): QueueItem[] {
  return sortQueueItems(
    dashboard.recentHealthDocs.map((row) => ({
      id: `recent-${row.id}`,
      kind: "recent_doc",
      tab: "documentation",
      memberId: row.memberId ?? null,
      memberName: row.memberName,
      title: row.memberName,
      subtitle: `${row.source} | ${row.detail}`,
      statusLabel: "Completed",
      tone: "success",
      priority: "routine",
      dueAt: row.when,
      dueText: formatDateTime(row.when),
      meta: [`Recorded ${formatDateTime(row.when)}`],
      tags: [row.source, "Recent documentation"],
      primaryHref: row.source === "MAR" ? "/health/mar" : "/documentation/blood-sugar",
      primaryActionLabel: row.source === "MAR" ? "Open MAR" : "Blood sugar history",
      secondaryHref: row.memberId ? `/health/member-health-profiles/${row.memberId}` : null,
      secondaryActionLabel: row.memberId ? "Member chart" : null
    }))
  );
}

function SummaryMetricCard({
  count,
  description,
  label,
  onClick
}: {
  count: number;
  description: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-sky-300 hover:shadow-[0_10px_30px_rgba(14,165,233,0.08)]"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{count}</p>
      <p className="mt-2 text-xs text-slate-500">{description}</p>
    </button>
  );
}

function DetailRail({ item }: { item: QueueItem | null }) {
  if (!item) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
        Select a queue item to see the clinical context and direct actions.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Selected detail</p>
      <h3 className="mt-2 text-lg font-semibold text-slate-900">{item.title}</h3>
      <p className="mt-1 text-sm text-slate-600">{item.subtitle}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Status</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">{item.statusLabel}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Due / timing</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">{item.dueText ?? "Review details"}</p>
        </div>
      </div>
      {item.meta.length > 0 ? (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Clinical context</p>
          <div className="mt-2 space-y-2">
            {item.meta.map((entry) => (
              <p key={entry} className="text-sm text-slate-700">
                {entry}
              </p>
            ))}
          </div>
        </div>
      ) : null}
      {item.tags.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {item.tags.map((tag) => (
            <span key={tag} className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600">
              {tag}
            </span>
          ))}
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={item.primaryHref} className="rounded-xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white">
          {item.primaryActionLabel}
        </Link>
        {item.secondaryHref && item.secondaryActionLabel ? (
          <Link href={item.secondaryHref} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">
            {item.secondaryActionLabel}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function QuickEntryPanel({
  capabilities,
  dashboard
}: {
  capabilities: NursingDashboardCapabilities;
  dashboard: HealthDashboardSnapshot;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Quick Clinical Entry</h3>
          <p className="mt-1 text-xs text-slate-500">Point-of-care charting kept compact. Long history stays in workflow pages.</p>
        </div>
        <Link href="/documentation/blood-sugar" className="text-sm font-semibold text-sky-700">
          Full blood sugar history
        </Link>
      </div>
      <div className="mt-4">
        <BloodSugarFormShell compact />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/health/mar" className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">
          MAR workflow
        </Link>
        {capabilities.canViewProgressNotes ? (
          <Link href="/health/progress-notes/new" className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">
            New progress note
          </Link>
        ) : null}
        {capabilities.canViewIncidents ? (
          <Link href="/documentation/incidents/new" className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">
            New incident
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function RecentBloodSugarPanel({ dashboard }: { dashboard: HealthDashboardSnapshot }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Recent Blood Sugar Checks</h3>
          <p className="mt-1 text-xs text-slate-500">Recent results stay visible without loading the full history grid.</p>
        </div>
        <Link href="/documentation/blood-sugar" className="text-sm font-semibold text-sky-700">
          Open history
        </Link>
      </div>
      <div className="mt-3 space-y-2">
        {dashboard.bloodSugarRows.slice(0, 6).map((row) => (
          <div key={row.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-slate-900">{row.member_name}</p>
              <p className="text-sm font-semibold text-slate-700">{row.reading_mg_dl} mg/dL</p>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {formatDateTime(row.checked_at)}
              {row.nurse_name ? ` | ${row.nurse_name}` : ""}
            </p>
          </div>
        ))}
        {dashboard.bloodSugarRows.length === 0 ? <p className="text-sm text-slate-500">No recent blood sugar checks.</p> : null}
      </div>
    </div>
  );
}

export function NursingDashboardWorkspace({
  capabilities,
  dashboard
}: {
  capabilities: NursingDashboardCapabilities;
  dashboard: HealthDashboardSnapshot;
}) {
  const [activeTab, setActiveTab] = useState<HealthDashboardTab>("overview");
  const [memberQuery, setMemberQuery] = useState("");
  const [dueStatus, setDueStatus] = useState<DashboardDueStatus>("all");
  const [documentationType, setDocumentationType] = useState<DashboardDocumentationType>("all");
  const [riskFilter, setRiskFilter] = useState<DashboardRiskFilter>("all");
  const [timeframe, setTimeframe] = useState<DashboardTimeframe>("today");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const deferredMemberQuery = useDeferredValue(normalizeText(memberQuery));

  const medicationItems = useMemo(() => buildMedicationItems(dashboard), [dashboard]);
  const progressNoteItems = useMemo(() => buildProgressNoteItems(dashboard), [dashboard]);
  const carePlanItems = useMemo(() => buildCarePlanItems(dashboard), [dashboard]);
  const incidentItems = useMemo(() => buildIncidentItems(dashboard), [dashboard]);
  const alertItems = useMemo(() => buildAlertItems(dashboard), [dashboard]);
  const recentDocumentationItems = useMemo(() => buildRecentDocumentationItems(dashboard), [dashboard]);

  const documentationItems = useMemo(() => sortQueueItems([...progressNoteItems, ...carePlanItems]), [progressNoteItems, carePlanItems]);

  const filteredMedicationItems = useMemo(
    () =>
      medicationItems.filter(
        (item) => matchesMemberQuery(item, deferredMemberQuery) && matchesTimeframe(item, timeframe) && matchesDueStatus(item, dueStatus)
      ),
    [deferredMemberQuery, dueStatus, medicationItems, timeframe]
  );

  const filteredDocumentationItems = useMemo(
    () =>
      documentationItems.filter(
        (item) =>
          matchesMemberQuery(item, deferredMemberQuery) &&
          matchesDocumentationType(item, documentationType) &&
          matchesTimeframe(item, timeframe) &&
          matchesDueStatus(item, dueStatus)
      ),
    [deferredMemberQuery, documentationItems, documentationType, dueStatus, timeframe]
  );

  const filteredIncidentItems = useMemo(
    () => incidentItems.filter((item) => matchesMemberQuery(item, deferredMemberQuery) && matchesDueStatus(item, dueStatus)),
    [deferredMemberQuery, dueStatus, incidentItems]
  );

  const filteredAlertItems = useMemo(
    () =>
      alertItems.filter((item) => matchesMemberQuery(item, deferredMemberQuery) && matchesRiskFilter(item, riskFilter)),
    [alertItems, deferredMemberQuery, riskFilter]
  );

  const filteredRecentDocumentationItems = useMemo(
    () => recentDocumentationItems.filter((item) => matchesMemberQuery(item, deferredMemberQuery)),
    [deferredMemberQuery, recentDocumentationItems]
  );

  const urgentOverviewItems = useMemo(
    () =>
      sortQueueItems([
        ...filteredMedicationItems.filter((item) => item.priority === "urgent"),
        ...filteredDocumentationItems.filter((item) => item.priority === "urgent"),
        ...filteredIncidentItems.filter((item) => item.priority === "urgent"),
        ...filteredAlertItems.filter((item) => item.priority === "urgent")
      ]).slice(0, 10),
    [filteredAlertItems, filteredDocumentationItems, filteredIncidentItems, filteredMedicationItems]
  );

  const dueSoonOverviewItems = useMemo(
    () =>
      sortQueueItems([
        ...filteredMedicationItems.filter((item) => item.priority === "today" || item.priority === "soon"),
        ...filteredDocumentationItems.filter((item) => item.priority === "today" || item.priority === "soon"),
        ...filteredIncidentItems.filter((item) => item.priority === "today" || item.priority === "soon")
      ]).slice(0, 10),
    [filteredDocumentationItems, filteredIncidentItems, filteredMedicationItems]
  );

  const detailItems = useMemo(() => {
    switch (activeTab) {
      case "documentation":
        return filteredDocumentationItems;
      case "mar":
        return filteredMedicationItems;
      case "incidents":
        return filteredIncidentItems;
      case "alerts":
        return filteredAlertItems;
      case "quick-entry":
        return filteredRecentDocumentationItems;
      case "overview":
      default:
        return sortQueueItems([...urgentOverviewItems, ...dueSoonOverviewItems, ...filteredAlertItems.slice(0, 4)]);
    }
  }, [
    activeTab,
    dueSoonOverviewItems,
    filteredAlertItems,
    filteredDocumentationItems,
    filteredIncidentItems,
    filteredMedicationItems,
    filteredRecentDocumentationItems,
    urgentOverviewItems
  ]);

  useEffect(() => {
    if (detailItems.length === 0) {
      setSelectedItemId(null);
      return;
    }
    if (!selectedItemId || !detailItems.some((item) => item.id === selectedItemId)) {
      setSelectedItemId(detailItems[0].id);
    }
  }, [detailItems, selectedItemId]);

  const selectedItem = detailItems.find((item) => item.id === selectedItemId) ?? null;

  const documentationOverdueCount = documentationItems.filter((item) => item.priority === "urgent").length;
  const documentationDueSoonCount = documentationItems.filter((item) => item.priority === "today" || item.priority === "soon").length;
  const medsActionCount = medicationItems.length;
  const incidentActionCount = incidentItems.length;
  const highRiskAlertCount = alertItems.filter((item) => item.tags.includes("High risk")).length;

  const handleTabChange = (tab: HealthDashboardTab) => {
    setActiveTab(tab);
    if (tab === "incidents") {
      setDueStatus("open");
      return;
    }
    if (dueStatus === "open") {
      setDueStatus("all");
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,#f8fbff_0%,#eef5fb_100%)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Clinical workspace</p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950">Nursing Dashboard</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Run the day from active queues: what needs nursing attention now, what is due next, and which member alerts matter clinically.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Active census snapshot</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{dashboard.members.length}</p>
            <p className="mt-1 text-xs text-slate-500">Active members available for quick charting.</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <Link href="/health/mar" className="rounded-xl bg-sky-600 px-3 py-2 font-semibold text-white">
            Open MAR workflow
          </Link>
          {capabilities.canViewProgressNotes ? (
            <Link href="/health/progress-notes/new" className="rounded-xl border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-700">
              New progress note
            </Link>
          ) : null}
          {capabilities.canViewIncidents ? (
            <Link href="/documentation/incidents" className="rounded-xl border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-700">
              Incident follow-up
            </Link>
          ) : null}
          <Link href="/health/member-health-profiles" className="rounded-xl border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-700">
            Member charts
          </Link>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <SummaryMetricCard
          label="Documentation overdue"
          count={documentationOverdueCount}
          description="Open the overdue documentation queue."
          onClick={() => {
            setActiveTab("documentation");
            setDueStatus("overdue");
          }}
        />
        <SummaryMetricCard
          label="Documentation due soon"
          count={documentationDueSoonCount}
          description="Review care plans and progress notes due next."
          onClick={() => {
            setActiveTab("documentation");
            setDueStatus("due_soon");
          }}
        />
        <SummaryMetricCard
          label="Meds / treatments"
          count={medsActionCount}
          description="Medication and treatment work needing action."
          onClick={() => {
            setActiveTab("mar");
            setDueStatus("all");
          }}
        />
        {capabilities.canViewIncidents ? (
          <SummaryMetricCard
            label="Incidents requiring follow-up"
            count={incidentActionCount}
            description="Open incident records that still need nursing attention."
            onClick={() => {
              setActiveTab("incidents");
              setDueStatus("open");
            }}
          />
        ) : null}
        <SummaryMetricCard
          label="High-risk member alerts"
          count={highRiskAlertCount}
          description="Allergies, fall risk, DNR, diabetic, and other nursing flags."
          onClick={() => {
            setActiveTab("alerts");
            setRiskFilter("high");
          }}
        />
      </div>

      <NursingDashboardFilters
        activeTab={activeTab}
        memberQuery={memberQuery}
        dueStatus={dueStatus}
        documentationType={documentationType}
        riskFilter={riskFilter}
        timeframe={timeframe}
        onActiveTabChange={handleTabChange}
        onMemberQueryChange={setMemberQuery}
        onDueStatusChange={setDueStatus}
        onDocumentationTypeChange={setDocumentationType}
        onRiskFilterChange={setRiskFilter}
        onTimeframeChange={setTimeframe}
      />

      {activeTab === "overview" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_360px]">
          <div className="space-y-4">
            <NursingDashboardQueue
              title="Needs Attention Now"
              description="Urgent work queues surfaced first: overdue meds, overdue documentation, returned/reportable incidents, and high-risk alerts."
              items={urgentOverviewItems}
              selectedId={selectedItemId}
              onSelectItem={setSelectedItemId}
              emptyMessage="No urgent nursing items are surfaced right now."
            />
            <NursingDashboardQueue
              title="Due Next"
              description="What is due today or due soon, without making the nurse hunt through long tables."
              items={dueSoonOverviewItems}
              selectedId={selectedItemId}
              onSelectItem={setSelectedItemId}
              emptyMessage="No near-term follow-up items are currently due."
            />
            <NursingDashboardQueue
              title="Member Alerts / Exceptions"
              description="Compact, scan-friendly clinical alerts and member exceptions."
              items={filteredAlertItems.slice(0, 8)}
              selectedId={selectedItemId}
              onSelectItem={setSelectedItemId}
              emptyMessage="No member alerts are currently surfaced."
            />
          </div>
          <div className="space-y-4">
            <DetailRail item={selectedItem} />
            <QuickEntryPanel capabilities={capabilities} dashboard={dashboard} />
          </div>
        </div>
      ) : null}

      {activeTab === "documentation" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_360px]">
          <div className="space-y-4">
            <NursingDashboardQueue
              title="Documentation Queue"
              description="Actionable care plans and progress notes with direct open/resume actions."
              items={filteredDocumentationItems}
              selectedId={selectedItemId}
              onSelectItem={setSelectedItemId}
              emptyMessage="No documentation items match the current filters."
            />
            <NursingDashboardQueue
              title="Recently Completed Documentation"
              description="Recent clinical documentation stays visible, but secondary to due work."
              items={filteredRecentDocumentationItems.slice(0, 8)}
              selectedId={selectedItemId}
              onSelectItem={setSelectedItemId}
              emptyMessage="No recent documentation is currently surfaced."
            />
          </div>
          <div className="space-y-4">
            <DetailRail item={selectedItem} />
            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
              <h3 className="text-sm font-semibold text-slate-900">Drill-down workflows</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {capabilities.canViewProgressNotes ? (
                  <Link href="/health/progress-notes" className="rounded-xl border border-slate-200 px-3 py-2 font-semibold text-slate-700">
                    Progress note tracker
                  </Link>
                ) : null}
                {capabilities.canViewCarePlans ? (
                  <Link href="/health/care-plans" className="rounded-xl border border-slate-200 px-3 py-2 font-semibold text-slate-700">
                    Care plans
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "mar" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_360px]">
          <div className="space-y-4">
            <NursingDashboardQueue
              title="Medication / Treatment Queue"
              description="Due now, overdue, and near-term medication work only. Full MAR remains in the dedicated workflow."
              items={filteredMedicationItems}
              selectedId={selectedItemId}
              onSelectItem={setSelectedItemId}
              emptyMessage="No medication or treatment items match the current filters."
            />
          </div>
          <div className="space-y-4">
            <DetailRail item={selectedItem} />
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-slate-900">MAR actions</h3>
              <p className="mt-1 text-xs text-slate-500">Use the dedicated MAR board for administration, PRN follow-up, and not-given documentation.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/health/mar" className="rounded-xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white">
                  Open MAR board
                </Link>
                <Link href="/health/physician-orders" className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">
                  Physician orders / POF
                </Link>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "incidents" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_360px]">
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Submitted</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">{dashboard.incidents.counts.submitted}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Returned</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">{dashboard.incidents.counts.returned}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Approved open</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">{dashboard.incidents.counts.approved}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Reportable open</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">{dashboard.incidents.counts.reportableOpen}</p>
              </div>
            </div>
            <NursingDashboardQueue
              title="Incident Follow-up Queue"
              description="Open incidents needing review, return correction, or downstream nursing follow-up."
              items={filteredIncidentItems}
              selectedId={selectedItemId}
              onSelectItem={setSelectedItemId}
              emptyMessage="No incidents require follow-up for the current filters."
            />
          </div>
          <div className="space-y-4">
            <DetailRail item={selectedItem} />
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-slate-900">Incident workflows</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/documentation/incidents" className="rounded-xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white">
                  Open incident queue
                </Link>
                <Link href="/documentation/incidents/new" className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">
                  New incident
                </Link>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "quick-entry" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_360px]">
          <div className="space-y-4">
            <QuickEntryPanel capabilities={capabilities} dashboard={dashboard} />
            <RecentBloodSugarPanel dashboard={dashboard} />
          </div>
          <div className="space-y-4">
            <NursingDashboardQueue
              title="Recent Documentation"
              description="Recent charting stays nearby while quick entry remains primary."
              items={filteredRecentDocumentationItems.slice(0, 6)}
              selectedId={selectedItemId}
              onSelectItem={setSelectedItemId}
              emptyMessage="No recent documentation is currently surfaced."
            />
            <DetailRail item={selectedItem} />
            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
              <h3 className="text-sm font-semibold text-slate-900">Quick links</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/health/assessment" className="rounded-xl border border-slate-200 px-3 py-2 font-semibold text-slate-700">
                  New intake assessment
                </Link>
                <Link href="/health/member-health-profiles" className="rounded-xl border border-slate-200 px-3 py-2 font-semibold text-slate-700">
                  Member health profiles
                </Link>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "alerts" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_360px]">
          <div className="space-y-4">
            <NursingDashboardQueue
              title="Member Alerts / Exceptions"
              description="Compact scan of allergies, diet restrictions, code status, fall risk, seizure precautions, diabetic flags, and other nursing alerts."
              items={filteredAlertItems}
              selectedId={selectedItemId}
              onSelectItem={setSelectedItemId}
              emptyMessage="No member alerts match the current filters."
            />
          </div>
          <div className="space-y-4">
            <DetailRail item={selectedItem} />
            <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
              <h3 className="text-sm font-semibold text-slate-900">Alert drill-down</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href="/health/member-health-profiles" className="rounded-xl bg-sky-600 px-3 py-2 text-sm font-semibold text-white">
                  Open member charts
                </Link>
                {capabilities.canViewCarePlans ? (
                  <Link href="/health/care-plans" className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">
                    Care plans
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
