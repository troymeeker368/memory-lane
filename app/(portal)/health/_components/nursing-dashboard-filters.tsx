"use client";

import { cn } from "@/lib/utils";

import type {
  DashboardDocumentationType,
  DashboardDueStatus,
  DashboardRiskFilter,
  DashboardTimeframe,
  HealthDashboardTab
} from "@/app/(portal)/health/_components/nursing-dashboard-types";

const TAB_OPTIONS: Array<{ id: HealthDashboardTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "documentation", label: "Documentation" },
  { id: "mar", label: "MAR / Treatments" },
  { id: "incidents", label: "Incidents / Follow-up" },
  { id: "quick-entry", label: "Quick Entry" },
  { id: "alerts", label: "Member Alerts" }
];

export function NursingDashboardFilters({
  activeTab,
  documentationType,
  dueStatus,
  memberQuery,
  onActiveTabChange,
  onDocumentationTypeChange,
  onDueStatusChange,
  onMemberQueryChange,
  onRiskFilterChange,
  onTimeframeChange,
  riskFilter,
  timeframe
}: {
  activeTab: HealthDashboardTab;
  documentationType: DashboardDocumentationType;
  dueStatus: DashboardDueStatus;
  memberQuery: string;
  onActiveTabChange: (tab: HealthDashboardTab) => void;
  onDocumentationTypeChange: (value: DashboardDocumentationType) => void;
  onDueStatusChange: (value: DashboardDueStatus) => void;
  onMemberQueryChange: (value: string) => void;
  onRiskFilterChange: (value: DashboardRiskFilter) => void;
  onTimeframeChange: (value: DashboardTimeframe) => void;
  riskFilter: DashboardRiskFilter;
  timeframe: DashboardTimeframe;
}) {
  return (
    <div className="sticky top-0 z-10 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-[0_8px_30px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className="flex flex-wrap gap-2">
        {TAB_OPTIONS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onActiveTabChange(tab.id)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm font-semibold transition",
              activeTab === tab.id
                ? "border-sky-600 bg-sky-600 text-white"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Member</span>
          <input
            value={memberQuery}
            onChange={(event) => onMemberQueryChange(event.target.value)}
            placeholder="Search member"
            className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-500"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Due Status</span>
          <select
            value={dueStatus}
            onChange={(event) => onDueStatusChange(event.target.value as DashboardDueStatus)}
            className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-500"
          >
            <option value="all">All</option>
            <option value="overdue">Overdue</option>
            <option value="due_now">Due now / today</option>
            <option value="due_soon">Due soon</option>
            <option value="open">Open follow-up</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Documentation</span>
          <select
            value={documentationType}
            onChange={(event) => onDocumentationTypeChange(event.target.value as DashboardDocumentationType)}
            className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-500"
          >
            <option value="all">All</option>
            <option value="progress_note">Progress notes</option>
            <option value="care_plan">Care plans</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Risk Focus</span>
          <select
            value={riskFilter}
            onChange={(event) => onRiskFilterChange(event.target.value as DashboardRiskFilter)}
            className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-500"
          >
            <option value="all">All alerts</option>
            <option value="high">High risk only</option>
            <option value="standard">Standard alerts</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Timeframe</span>
          <select
            value={timeframe}
            onChange={(event) => onTimeframeChange(event.target.value as DashboardTimeframe)}
            className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-500"
          >
            <option value="today">Today</option>
            <option value="next_7_days">Next 7 days</option>
            <option value="all">All surfaced</option>
          </select>
        </label>
      </div>
    </div>
  );
}
