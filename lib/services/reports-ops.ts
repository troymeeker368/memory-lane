import {
  getReportsHomeOperationsSnapshot,
  REPORTS_HOME_AGGREGATES_WINDOW_DAYS,
  REPORTS_HOME_AGGREGATES_WINDOW_LABEL
} from "@/lib/services/admin-reporting-foundation";

export { REPORTS_HOME_AGGREGATES_WINDOW_DAYS, REPORTS_HOME_AGGREGATES_WINDOW_LABEL };

export async function getOperationsReports() {
  return getReportsHomeOperationsSnapshot();
}
