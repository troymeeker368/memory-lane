import { unstable_noStore as noStore } from "next/cache";

import { DocumentBrandHeader } from "@/components/documents/document-brand-header";
import { ManifestPrintActions } from "@/components/transportation-station/manifest-print-actions";
import { BackArrowButton } from "@/components/ui/back-arrow-button";
import { requireModuleAccess } from "@/lib/auth";
import { getConfiguredBusNumbers } from "@/lib/services/operations-settings";
import {
  getTransportationManifestSupabase,
  type TransportationManifestBusFilter,
  type TransportationStationShift
} from "@/lib/services/transportation-station-supabase";
import { toEasternDate } from "@/lib/timezone";
import { formatDate, formatDateTime } from "@/lib/utils";

const WEEKDAY_LABELS: Record<string, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday"
};

function firstString(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function normalizeShift(value: string | undefined): TransportationStationShift {
  if (value === "AM" || value === "PM" || value === "Both") return value;
  return "Both";
}

function normalizeBusFilter(value: string | undefined, busNumberOptions: string[]): TransportationManifestBusFilter {
  if (!value) return "all";
  if (value === "all" || value === "unassigned") return value;
  if (busNumberOptions.includes(value)) return value;
  return "all";
}

export default async function TransportationManifestPrintPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  noStore();
  await requireModuleAccess("operations");
  const params = await searchParams;
  const busNumberOptions = await getConfiguredBusNumbers();
  const date = firstString(params.date) ?? toEasternDate();
  const shift = normalizeShift(firstString(params.shift));
  const bus = normalizeBusFilter(firstString(params.bus), busNumberOptions);
  const manifest = await getTransportationManifestSupabase({
    selectedDate: date,
    shift,
    busFilter: bus
  });
  const shiftDisplayOrder: Array<"AM" | "PM"> = shift === "Both" ? ["AM", "PM"] : [shift];
  const weekdayLabel = WEEKDAY_LABELS[manifest.weekday] ?? manifest.weekday;
  const busPages = manifest.groups
    .map((group) => ({
      group,
      shifts: shiftDisplayOrder
        .map((selectedShift) => ({
          selectedShift,
          riders: group.riders.filter((row) => row.shift === selectedShift)
        }))
        .filter((entry) => entry.riders.length > 0)
    }))
    .filter((entry) => entry.shifts.length > 0);
  const baseMetaLines = [
    `Generated: ${formatDateTime(manifest.generatedAt)} (ET)`,
    `Date: ${formatDate(manifest.selectedDate)}`,
    `Shift: ${manifest.selectedShift}`,
    `Total Riders: ${manifest.totalRiders}`
  ];

  const backHref = `/operations/transportation-station?date=${manifest.selectedDate}&shift=${manifest.selectedShift}&bus=${bus}`;

  return (
    <div className="face-sheet-page space-y-4">
      <div className="print-hide flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BackArrowButton fallbackHref={backHref} forceFallback ariaLabel="Back to Transportation Station" />
          <a href={backHref} className="text-sm font-semibold text-brand">
            Back to Transportation Station
          </a>
        </div>
        <ManifestPrintActions />
      </div>

      <div className="print-hide">
        <DocumentBrandHeader title="Transportation Manifest" metaLines={baseMetaLines} />
      </div>

      {busPages.length === 0 ? (
        <>
          <DocumentBrandHeader title="Transportation Manifest" metaLines={baseMetaLines} className="hidden print:block" />
          <section>
            <p className="text-sm">No riders match this date/shift selection.</p>
          </section>
        </>
      ) : (
        busPages.map((busPage, busIndex) => (
          <section
            key={`bus-page-${busPage.group.label}`}
            className="face-sheet-section"
            style={busIndex < busPages.length - 1 ? { breakAfter: "page", pageBreakAfter: "always" } : undefined}
          >
            <DocumentBrandHeader
              title="Transportation Manifest"
              metaLines={[...baseMetaLines, `Bus: ${busPage.group.label}`]}
              className="mb-3 hidden print:block"
            />
            <h2 className="face-sheet-heading">
              {busPage.group.label} | {weekdayLabel} ({formatDate(manifest.selectedDate)})
            </h2>
            {busPage.shifts.map((shiftGroup) => (
              <div key={`${busPage.group.label}-${shiftGroup.selectedShift}`} className="mb-3 last:mb-0">
                <p className="mb-1 text-sm font-semibold">
                  {shiftGroup.selectedShift} Manifest
                </p>
                <table className="face-sheet-table">
                  <thead>
                    <tr>
                      <th>Member</th>
                      <th>Type</th>
                      <th>Location</th>
                      <th>Contact</th>
                      <th>Phone</th>
                      <th>Address</th>
                      <th>Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shiftGroup.riders.map((rider) => (
                      <tr key={`${busPage.group.label}-${shiftGroup.selectedShift}-${rider.key}`}>
                        <td>{rider.memberName}</td>
                        <td>{rider.transportType}</td>
                        <td>{rider.locationLabel}</td>
                        <td>{rider.caregiverContactName ?? "-"}</td>
                        <td>{rider.caregiverContactPhone ?? "-"}</td>
                        <td>{rider.caregiverContactAddress ?? "-"}</td>
                        <td>{rider.source === "manual-add" ? "Manual Add" : "Schedule"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </section>
        ))
      )}

      {manifest.exclusions.length > 0 ? (
        <section className="face-sheet-section" style={busPages.length > 0 ? { breakBefore: "page", pageBreakBefore: "always" } : undefined}>
          <DocumentBrandHeader
            title="Transportation Manifest"
            metaLines={[...baseMetaLines, "Section: Exclusions"]}
            className="mb-3 hidden print:block"
          />
          <h2 className="face-sheet-heading">Exclusions Applied</h2>
          <table className="face-sheet-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Shift</th>
                <th>Created</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {manifest.exclusions.map((row) => (
                <tr key={`exclusion-${row.id}`}>
                  <td>{row.memberName}</td>
                  <td>{row.shift}</td>
                  <td>{formatDateTime(row.createdAt)}</td>
                  <td>{row.createdByName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
