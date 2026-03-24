import {
  getCarePlanById as getCarePlanByIdModel,
  getCarePlanDashboard as getCarePlanDashboardModel,
  getCarePlanDispatchState as getCarePlanDispatchStateModel,
  getMemberCarePlanSnapshot as getMemberCarePlanSnapshotModel,
  getCarePlanParticipationSummary as getCarePlanParticipationSummaryModel,
  getCarePlans as getCarePlansModel,
  getCarePlansForMember as getCarePlansForMemberModel,
  getMemberCarePlanOverview as getMemberCarePlanOverviewModel,
  getLatestCarePlanIdForMember as getLatestCarePlanIdForMemberModel,
  getCarePlanVersionById as getCarePlanVersionByIdModel,
  getLatestCarePlanForMember as getLatestCarePlanForMemberModel,
  getMemberCarePlanSummary as getMemberCarePlanSummaryModel
} from "@/lib/services/care-plans-read-model";
import {
  CARE_PLAN_LONG_TERM_LABEL,
  CARE_PLAN_REVIEW_OPTIONS,
  CARE_PLAN_REVIEW_UPDATES_LABEL,
  CARE_PLAN_SHORT_TERM_LABEL,
  getGoalListItems
} from "@/lib/services/care-plan-track-definitions";

export {
  CARE_PLAN_LONG_TERM_LABEL,
  CARE_PLAN_REVIEW_OPTIONS,
  CARE_PLAN_REVIEW_UPDATES_LABEL,
  CARE_PLAN_SHORT_TERM_LABEL,
  getGoalListItems
};

export async function getCarePlanList(...args: Parameters<typeof getCarePlansModel>) {
  return getCarePlansModel(...args);
}

export async function getCarePlans(...args: Parameters<typeof getCarePlansModel>) {
  return getCarePlansModel(...args);
}

export async function getCarePlanById(...args: Parameters<typeof getCarePlanByIdModel>) {
  return getCarePlanByIdModel(...args);
}

export async function getCarePlansForMember(...args: Parameters<typeof getCarePlansForMemberModel>) {
  return getCarePlansForMemberModel(...args);
}

export async function getMemberCarePlanOverview(...args: Parameters<typeof getMemberCarePlanOverviewModel>) {
  return getMemberCarePlanOverviewModel(...args);
}

export async function getLatestCarePlanIdForMember(...args: Parameters<typeof getLatestCarePlanIdForMemberModel>) {
  return getLatestCarePlanIdForMemberModel(...args);
}

export async function getLatestCarePlanForMember(...args: Parameters<typeof getLatestCarePlanForMemberModel>) {
  return getLatestCarePlanForMemberModel(...args);
}

export async function getMemberCarePlanSummary(...args: Parameters<typeof getMemberCarePlanSummaryModel>) {
  return getMemberCarePlanSummaryModel(...args);
}

export async function getMemberCarePlanSnapshot(...args: Parameters<typeof getMemberCarePlanSnapshotModel>) {
  return getMemberCarePlanSnapshotModel(...args);
}

export async function getCarePlanParticipationSummary(...args: Parameters<typeof getCarePlanParticipationSummaryModel>) {
  return getCarePlanParticipationSummaryModel(...args);
}

export async function getCarePlanDashboard(...args: Parameters<typeof getCarePlanDashboardModel>) {
  return getCarePlanDashboardModel(...args);
}

export async function getCarePlanVersionById(...args: Parameters<typeof getCarePlanVersionByIdModel>) {
  return getCarePlanVersionByIdModel(...args);
}

export async function getCarePlanDispatchState(...args: Parameters<typeof getCarePlanDispatchStateModel>) {
  return getCarePlanDispatchStateModel(...args);
}
