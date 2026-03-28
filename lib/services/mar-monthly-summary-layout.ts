import { EASTERN_TIME_ZONE } from "@/lib/timezone";
import type { MarMonthlyMedicationSummary, MarMonthlyReportData } from "@/lib/services/mar-monthly-report";

export type SummaryGridCell = {
  day: number;
  label: string;
  status: "given" | "not-given";
};

export type SummaryGridRow = {
  key: string;
  medicationName: string;
  orderLabel: string;
  timeLabel: string;
  cells: Map<number, SummaryGridCell>;
};

function clean(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function initialsFromStaffName(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
}

function formatTimeToken(value: string | null | undefined) {
  const normalized = clean(value);
  if (!normalized) return "-";

  const directMatch = /^(\d{1,2}):(\d{2})/.exec(normalized);
  if (directMatch) {
    return `${directMatch[1].padStart(2, "0")}:${directMatch[2]}`;
  }

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return normalized;

  return new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function dayOfMonthInEastern(value: string | null | undefined) {
  const normalized = clean(value);
  if (!normalized) return null;

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;

  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: EASTERN_TIME_ZONE,
      day: "numeric"
    }).format(date)
  );
}

function summarizeOrderLabel(medication: MarMonthlyMedicationSummary) {
  return [medication.strength ?? medication.dose, medication.route, medication.frequency ?? medication.sig]
    .filter(Boolean)
    .join(" | ") || "-";
}

export function buildMarSummaryGridRows(report: MarMonthlyReportData): SummaryGridRow[] {
  const medicationById = new Map(report.medications.map((row) => [row.pofMedicationId, row] as const));
  const rowMap = new Map<string, SummaryGridRow>();

  const ensureRow = (key: string, medicationName: string, orderLabel: string, timeLabel: string) => {
    const existing = rowMap.get(key);
    if (existing) return existing;

    const created: SummaryGridRow = {
      key,
      medicationName,
      orderLabel,
      timeLabel,
      cells: new Map()
    };
    rowMap.set(key, created);
    return created;
  };

  report.medications
    .filter((medication) => !medication.prn)
    .forEach((medication) => {
      const timeTokens = medication.scheduledTimes.map((time) => formatTimeToken(time));
      timeTokens.forEach((timeLabel) => {
        ensureRow(
          `${medication.pofMedicationId}|${timeLabel}`,
          medication.medicationName,
          summarizeOrderLabel(medication),
          timeLabel
        );
      });
    });

  report.detailRows
    .filter((row) => row.source === "scheduled")
    .forEach((detailRow) => {
      const timeLabel = formatTimeToken(detailRow.dueTime ?? detailRow.administeredAt);
      const day = dayOfMonthInEastern(detailRow.dueTime ?? detailRow.administeredAt);
      const medication = detailRow.pofMedicationId ? medicationById.get(detailRow.pofMedicationId) : null;
      const rowKey = `${detailRow.pofMedicationId ?? detailRow.medicationName}|${timeLabel}`;
      const summaryRow = ensureRow(
        rowKey,
        medication?.medicationName ?? detailRow.medicationName,
        medication ? summarizeOrderLabel(medication) : "-",
        timeLabel
      );

      if (!day) return;

      summaryRow.cells.set(day, {
        day,
        label: detailRow.status === "Given" ? initialsFromStaffName(detailRow.staffName) : "NG",
        status: detailRow.status === "Given" ? "given" : "not-given"
      });
    });

  return Array.from(rowMap.values()).sort((left, right) => {
    const medicationCompare = left.medicationName.localeCompare(right.medicationName, undefined, { sensitivity: "base" });
    if (medicationCompare !== 0) return medicationCompare;
    return left.timeLabel.localeCompare(right.timeLabel, undefined, { sensitivity: "base" });
  });
}
