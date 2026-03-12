import { getDocumentationSummary } from "@/lib/services/documentation";
import { createClient } from "@/lib/supabase/server";

type DocumentationReviewRecord = {
  status: "Pending" | "Reviewed" | "Needs Follow-up";
  notes: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
};

export async function getDocumentationReviewRows(periodLabel = "Today") {
  const summary = await getDocumentationSummary();
  const supabase = await createClient();
  const { data: auditRows, error } = await supabase
    .from("audit_logs")
    .select("created_at, details")
    .eq("entity_type", "documentation_review")
    .order("created_at", { ascending: false })
    .limit(2000);

  if (error) {
    throw new Error(error.message);
  }

  const reviewByStaffAndPeriod = new Map<string, DocumentationReviewRecord>();
  (auditRows ?? []).forEach((row: any) => {
    const details = row?.details as Record<string, unknown> | null;
    if (!details) return;
    const staffName = String(details.staffName ?? "").trim();
    const period = String(details.periodLabel ?? "").trim();
    const status = String(details.status ?? "").trim();
    if (!staffName || !period) return;
    if (status !== "Pending" && status !== "Reviewed" && status !== "Needs Follow-up") return;

    const key = `${staffName}::${period}`;
    if (reviewByStaffAndPeriod.has(key)) return;
    reviewByStaffAndPeriod.set(key, {
      status,
      notes: String(details.notes ?? ""),
      reviewed_by: details.reviewed_by == null ? null : String(details.reviewed_by),
      reviewed_at: details.reviewed_at == null ? (row?.created_at ?? null) : String(details.reviewed_at)
    });
  });

  return summary.timely.map((row: any) => {
    const review = reviewByStaffAndPeriod.get(`${row.staff_name}::${periodLabel}`) ?? null;
    return {
      staff_name: row.staff_name,
      on_time: row.on_time,
      late: row.late,
      total: row.total,
      on_time_percent: row.on_time_percent,
      review_status: review?.status ?? "Pending",
      review_notes: review?.notes ?? "",
      reviewed_by: review?.reviewed_by ?? null,
      reviewed_at: review?.reviewed_at ?? null,
      period_label: periodLabel
    };
  });
}
