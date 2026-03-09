import { getDocumentationReview } from "@/lib/mock-repo";
import { getDocumentationSummary } from "@/lib/services/documentation";

export async function getDocumentationReviewRows(periodLabel = "Today") {
  const summary = await getDocumentationSummary();

  return summary.timely.map((row: any) => {
    const review = getDocumentationReview(row.staff_name, periodLabel);
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
