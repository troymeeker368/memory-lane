import { unstable_noStore as noStore } from "next/cache";

import { DocumentBrandHeader } from "@/components/documents/document-brand-header";
import { ManifestPrintActions } from "@/components/transportation-station/manifest-print-actions";
import { BackArrowButton } from "@/components/ui/back-arrow-button";
import { requireModuleAccess } from "@/lib/auth";
import { formatPhoneDisplay } from "@/lib/phone";
import { getConfiguredBusNumbers } from "@/lib/services/operations-settings";
import {
  getTransportationManifest,
  type TransportationManifestBusFilter,
  type TransportationStationShift
} from "@/lib/services/transportation-read";
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

function busFilterLabel(busFilter: TransportationManifestBusFilter) {
  if (busFilter === "all") return "All active buses";
  if (busFilter === "unassigned") return "Unassigned riders";
  return `Bus ${busFilter}`;
}

export default async function TransportationManifestPrintPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  noStore();
  await requireModuleAccess("operations");
  const params = await searchParams;
  const date = firstString(params.date) ?? toEasternDate();
  const shift = normalizeShift(firstString(params.shift));
  const rawBus = firstString(params.bus);
  const [busNumberOptions, manifest] = await Promise.all([
    getConfiguredBusNumbers(),
    getTransportationManifest({
      selectedDate: date,
      shift,
      busFilter: rawBus ?? "all"
    })
  ]);
  const bus = normalizeBusFilter(rawBus, busNumberOptions);
  const shiftDisplayOrder: Array<"AM" | "PM"> = shift === "Both" ? ["AM", "PM"] : [shift];
  const weekdayLabel = WEEKDAY_LABELS[manifest.weekday] ?? manifest.weekday;
  const printableGroups = manifest.groups.filter((group) => {
    if (bus === "all") return group.busNumber !== null;
    if (bus === "unassigned") return group.busNumber === null;
    return group.busNumber === bus;
  });
  const printPages = printableGroups.flatMap((group) =>
    shiftDisplayOrder
      .map((selectedShift) => ({
        group,
        selectedShift,
        riders: group.riders.filter((row) => row.shift === selectedShift)
      }))
      .filter((entry) => entry.riders.length > 0)
  );
  const baseMetaLines = [
    `Generated: ${formatDateTime(manifest.generatedAt)} (ET)`,
    `Date: ${formatDate(manifest.selectedDate)}`,
    `View: ${busFilterLabel(bus)} | ${manifest.selectedShift}`,
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

      {printPages.length === 0 ? (
        <>
          <DocumentBrandHeader title="Transportation Manifest" metaLines={baseMetaLines} className="hidden print:block" />
          <section>
            <p className="text-sm">No riders match this date/shift selection.</p>
          </section>
        </>
      ) : (
        printPages.map((page, pageIndex) => (
          <section
            key={`manifest-page-${page.group.label}-${page.selectedShift}`}
            className="face-sheet-section"
            style={pageIndex < printPages.length - 1 ? { breakAfter: "page", pageBreakAfter: "always" } : undefined}
          >
            <DocumentBrandHeader
              title="Transportation Manifest"
              metaLines={[...baseMetaLines, `Bus: ${page.group.label}`, `Shift: ${page.selectedShift}`]}
              className="mb-3 hidden print:block"
            />
            <h2 className="face-sheet-heading">
              {page.group.label} | {page.selectedShift} | {weekdayLabel} ({formatDate(manifest.selectedDate)})
            </h2>
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
                {page.riders.map((rider) => (
                  <tr key={`${page.group.label}-${page.selectedShift}-${rider.key}`}>
                    <td>{rider.memberName}</td>
                    <td>{rider.transportType}</td>
                    <td>{rider.locationLabel}</td>
                    <td>{rider.caregiverContactName ?? "-"}</td>
                    <td>{formatPhoneDisplay(rider.caregiverContactPhone)}</td>
                    <td>{rider.caregiverContactAddress ?? "-"}</td>
                    <td>{rider.source === "manual-add" ? "Manual Add" : "Schedule"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}

      {manifest.exclusions.length > 0 ? (
        <section className="face-sheet-section" style={printPages.length > 0 ? { breakBefore: "page", pageBreakBefore: "always" } : undefined}>
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
