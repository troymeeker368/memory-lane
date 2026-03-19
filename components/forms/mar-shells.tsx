"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

import type { MarMonthlyReportPanel as MarMonthlyReportPanelComponent } from "@/components/forms/mar-monthly-report-panel";
import type { MarWorkflowBoard as MarWorkflowBoardComponent } from "@/components/forms/mar-workflow-board";

type MarMonthlyReportPanelProps = ComponentProps<typeof MarMonthlyReportPanelComponent>;
type MarWorkflowBoardProps = ComponentProps<typeof MarWorkflowBoardComponent>;

const MarMonthlyReportPanelInner = dynamic<MarMonthlyReportPanelProps>(
  () => import("@/components/forms/mar-monthly-report-panel").then((module) => module.MarMonthlyReportPanel),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted">Loading MAR report tools...</div> }
);

const MarWorkflowBoardInner = dynamic<MarWorkflowBoardProps>(
  () => import("@/components/forms/mar-workflow-board").then((module) => module.MarWorkflowBoard),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted">Loading MAR workflow...</div> }
);

export function MarMonthlyReportPanelShell(props: MarMonthlyReportPanelProps) {
  return <MarMonthlyReportPanelInner {...props} />;
}

export function MarWorkflowBoardShell(props: MarWorkflowBoardProps) {
  return <MarWorkflowBoardInner {...props} />;
}
