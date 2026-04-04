export const salesRoutes = {
  home: "/sales",
  activities: "/sales/activities",
  summary: "/sales/summary",
  newEntriesLogLeadActivity: "/sales/new-entries/log-lead-activity",
  newEntriesSendEnrollmentPacket: "/sales/new-entries/send-enrollment-packet",
  pipelineIndex: "/sales/pipeline",
  pipelineLeadsTable: "/sales/pipeline/leads-table",
  pipelineByStage: "/sales/pipeline/by-stage",
  pipelineFollowUpDashboard: "/sales/pipeline/follow-up-dashboard",
  pipelineEnrollmentPackets: "/sales/pipeline/enrollment-packets",
  pipelineInquiry: "/sales/pipeline/inquiry",
  pipelineTour: "/sales/pipeline/tour",
  pipelineEip: "/sales/pipeline/eip",
  pipelineNurture: "/sales/pipeline/nurture",
  pipelineReferralsOnly: "/sales/pipeline/referrals-only",
  pipelineClosedWon: "/sales/pipeline/closed-won",
  pipelineClosedLost: "/sales/pipeline/closed-lost",
  leadDetail(leadId: string) {
    return `/sales/leads/${leadId}`;
  },
  leadEdit(leadId: string) {
    return `/sales/leads/${leadId}/edit`;
  },
  compatibility: {
    pipelineTable: "/sales/pipeline-table",
    pipelineByStage: "/sales/pipeline-by-stage",
    inquiry: "/sales/inquiry",
    tour: "/sales/tour",
    eip: "/sales/eip",
    nurture: "/sales/nurture",
    won: "/sales/won",
    lost: "/sales/lost",
    referralsOnly: "/sales/referrals-only"
  }
} as const;

export const salesCanonicalLeadViewPaths = [
  salesRoutes.home,
  salesRoutes.activities,
  salesRoutes.pipelineIndex,
  salesRoutes.pipelineEnrollmentPackets,
  salesRoutes.pipelineLeadsTable,
  salesRoutes.pipelineByStage,
  salesRoutes.pipelineFollowUpDashboard,
  salesRoutes.pipelineInquiry,
  salesRoutes.pipelineTour,
  salesRoutes.pipelineEip,
  salesRoutes.pipelineNurture,
  salesRoutes.pipelineClosedWon,
  salesRoutes.pipelineClosedLost,
  salesRoutes.summary
] as const;

export const memberRoutes = {
  directory: "/members",
  detail(memberId: string) {
    return `/members/${memberId}`;
  },
  commandCenterIndex: "/operations/member-command-center",
  commandCenterDetail(memberId: string) {
    return `/operations/member-command-center/${memberId}`;
  },
  commandCenterTab(memberId: string, tab: string) {
    return `/operations/member-command-center/${memberId}?tab=${encodeURIComponent(tab)}`;
  },
  healthProfileIndex: "/health/member-health-profiles",
  healthProfileDetail(memberId: string) {
    return `/health/member-health-profiles/${memberId}`;
  },
  healthProfileTab(memberId: string, tab: string) {
    return `/health/member-health-profiles/${memberId}?tab=${encodeURIComponent(tab)}`;
  },
  faceSheet(memberId: string) {
    return `/members/${memberId}/face-sheet`;
  },
  nameBadge(memberId: string) {
    return `/members/${memberId}/name-badge`;
  },
  dietCard(memberId: string) {
    return `/members/${memberId}/diet-card`;
  }
} as const;
