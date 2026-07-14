import { getReportsHomeDocumentationSnapshot } from "@/lib/services/admin-reporting-foundation";

export async function getReportingSnapshot() {
  return getReportsHomeDocumentationSnapshot();
}
