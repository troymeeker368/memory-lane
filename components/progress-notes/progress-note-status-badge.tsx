import { getProgressNoteComplianceLabel, type ProgressNoteComplianceStatus } from "@/lib/services/progress-note-model";

function statusClass(status: ProgressNoteComplianceStatus) {
  if (status === "overdue") return "border-rose-200 bg-rose-50 text-rose-700";
  if (status === "due") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "due_soon") return "border-blue-200 bg-blue-50 text-blue-700";
  if (status === "data_issue") return "border-orange-200 bg-orange-50 text-orange-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

export function ProgressNoteStatusBadge({ status }: { status: ProgressNoteComplianceStatus }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${statusClass(status)}`}>
      {getProgressNoteComplianceLabel(status)}
    </span>
  );
}
