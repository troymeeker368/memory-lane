import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";

import {
  addTransportationManifestRiderAction,
  excludeTransportationManifestRiderAction,
  reassignTransportationManifestBusAction,
  undoTransportationManifestAdjustmentAction
} from "@/app/(portal)/operations/transportation-station/actions";
import { TransportationStationAddRiderForm } from "@/components/forms/transportation-station-add-rider-form";
import { BackArrowButton } from "@/components/ui/back-arrow-button";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { getMockDb } from "@/lib/mock-repo";
import { getOperationsTodayDate } from "@/lib/services/operations-calendar";
import { getConfiguredBusNumbers } from "@/lib/services/operations-settings";
import {
  buildTransportationManifestCsv,
  getTransportationManifest,
  type TransportationManifestBusFilter,
  type TransportationStationShift
} from "@/lib/services/transportation-station";
import { formatDate, formatDateTime } from "@/lib/utils";

const SHIFT_OPTIONS: TransportationStationShift[] = ["AM", "PM", "Both"];
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

function formatShiftLabel(value: TransportationStationShift) {
  return value === "Both" ? "AM + PM" : value;
}

function contactPriority(category: string | null | undefined): number {
  const normalized = (category ?? "").trim().toLowerCase();
  if (normalized === "responsible party") return 1;
  if (normalized === "care provider") return 2;
  if (normalized === "emergency contact") return 3;
  if (normalized === "spouse") return 4;
  if (normalized === "child") return 5;
  if (normalized === "payor") return 6;
  if (normalized === "other") return 7;
  return 8;
}

function joinAddress(parts: Array<string | null | undefined>) {
  return (
    parts
      .map((value) => (value ?? "").trim())
      .filter(Boolean)
      .join(", ") || null
  );
}

export default async function TransportationStationPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  noStore();
  const profile = await requireModuleAccess("operations");
  const canEdit = profile.role === "admin" || profile.role === "manager";
  const busNumberOptions = getConfiguredBusNumbers();
  const query = await searchParams;
  const selectedDate = firstString(query.date) ?? getOperationsTodayDate();
  const selectedShift = normalizeShift(firstString(query.shift));
  const busFilter = normalizeBusFilter(firstString(query.bus), busNumberOptions);
  const busFilterOptions: TransportationManifestBusFilter[] = ["all", ...busNumberOptions, "unassigned"];
  const errorMessage = firstString(query.error) ?? "";
  const successMessage = firstString(query.success) ?? "";
  const manifest = getTransportationManifest({
    selectedDate,
    shift: selectedShift,
    busFilter
  });

  const csv = buildTransportationManifestCsv(manifest);
  const csvHref = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
  const db = getMockDb();
  const activeMembers = [
    ...new Map(
      db.members
        .filter((member) => member.status === "active")
        .map((member) => [member.id, member])
    ).values()
  ]
    .sort((left, right) => left.display_name.localeCompare(right.display_name, undefined, { sensitivity: "base" }));
  const commandCenterByMember = new Map(db.memberCommandCenters.map((row) => [row.member_id, row] as const));
  const sortedContacts = [...db.memberContacts].sort((left, right) => {
    const memberCompare = left.member_id.localeCompare(right.member_id);
    if (memberCompare !== 0) return memberCompare;
    const categoryCompare = contactPriority(left.category) - contactPriority(right.category);
    if (categoryCompare !== 0) return categoryCompare;
    if (left.updated_at === right.updated_at) return 0;
    return left.updated_at > right.updated_at ? -1 : 1;
  });
  const preferredContactByMember = new Map<string, (typeof db.memberContacts)[number]>();
  sortedContacts.forEach((contact) => {
    if (!preferredContactByMember.has(contact.member_id)) {
      preferredContactByMember.set(contact.member_id, contact);
    }
  });
  const addRiderMemberOptions = activeMembers.map((member) => {
    const commandCenter = commandCenterByMember.get(member.id);
    const preferredContact = preferredContactByMember.get(member.id);
    return {
      id: member.id,
      displayName: member.display_name,
      defaultDoorToDoorAddress: joinAddress([
        commandCenter?.street_address ?? null,
        commandCenter?.city ?? null,
        commandCenter?.state ?? null,
        commandCenter?.zip ?? null
      ]),
      defaultContactId: preferredContact?.id ?? null,
      defaultContactName: preferredContact?.contact_name ?? null,
      defaultContactPhone:
        preferredContact?.cellular_number ?? preferredContact?.home_number ?? preferredContact?.work_number ?? null,
      defaultContactAddress: joinAddress([
        preferredContact?.street_address ?? null,
        preferredContact?.city ?? null,
        preferredContact?.state ?? null,
        preferredContact?.zip ?? null
      ])
    };
  });
  const shiftDisplayOrder: Array<"AM" | "PM"> = selectedShift === "Both" ? ["AM", "PM"] : [selectedShift];
  const weekdayLabel = WEEKDAY_LABELS[manifest.weekday] ?? manifest.weekday;
  const groupedByShiftAndDay = shiftDisplayOrder
    .map((shift) => ({
      shift,
      weekdayLabel,
      busGroups: manifest.groups
        .map((group) => ({
          ...group,
          riders: group.riders.filter((row) => row.shift === shift)
        }))
        .filter((group) => group.riders.length > 0)
    }))
    .filter((entry) => entry.busGroups.length > 0);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <BackArrowButton fallbackHref="/operations" forceFallback ariaLabel="Back to operations" />
          <div>
            <CardTitle>Transportation Station</CardTitle>
            <p className="mt-1 text-sm text-muted">
              Daily transportation manifest grouped by bus number, sourced from MCC transport schedules with one-day add/exclude overrides.
            </p>
          </div>
        </div>
      </Card>

      {errorMessage ? (
        <Card>
          <p className="text-sm font-semibold text-danger">{errorMessage}</p>
        </Card>
      ) : null}
      {successMessage ? (
        <Card>
          <p className="text-sm font-semibold text-emerald-700">{successMessage}</p>
        </Card>
      ) : null}

      <Card className="table-wrap">
        <form method="get" className="grid gap-2 md:grid-cols-5">
          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Date</span>
            <input type="date" name="date" defaultValue={manifest.selectedDate} className="h-10 w-full rounded-lg border border-border px-3" />
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Shift</span>
            <select name="shift" defaultValue={selectedShift} className="h-10 w-full rounded-lg border border-border px-3">
              {SHIFT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-xs font-semibold text-muted">Bus Filter</span>
            <select name="bus" defaultValue={busFilter} className="h-10 w-full rounded-lg border border-border px-3">
              {busFilterOptions.map((option) => (
                <option key={option} value={option}>
                  {option === "all" ? "All Buses" : option === "unassigned" ? "Unassigned" : `Bus ${option}`}
                </option>
              ))}
            </select>
          </label>

          <button type="submit" className="h-10 self-end rounded-lg bg-brand px-3 text-sm font-semibold text-white">
            Generate Manifest
          </button>

          <Link
            href="/operations/transportation-station"
            className="h-10 self-end rounded-lg border border-border px-3 text-center text-sm font-semibold leading-10"
          >
            Clear
          </Link>
        </form>

        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted">
          <span>
            Generated: {formatDateTime(manifest.generatedAt)} | Date: {formatDate(manifest.selectedDate)} | Shift: {formatShiftLabel(manifest.selectedShift)}
          </span>
          <span>Total Riders: {manifest.totalRiders}</span>
          <span>Groups: {manifest.groups.length}</span>
          <span>On-Hold Excluded: {manifest.holdExcludedScheduledRiders.length}</span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a
            href={`/operations/transportation-station/print?date=${manifest.selectedDate}&shift=${manifest.selectedShift}&bus=${busFilter}`}
            className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white"
            target="_blank"
            rel="noopener noreferrer"
          >
            Print / PDF Manifest
          </a>
          <a href={csvHref} download={`transport-manifest-${manifest.selectedDate}-${manifest.selectedShift.toLowerCase()}.csv`} className="rounded-lg border border-border px-3 py-2 text-sm font-semibold">
            Export CSV
          </a>
        </div>
      </Card>

      {canEdit ? (
        <Card>
          <CardTitle>Add On-the-Fly Rider</CardTitle>
          <p className="mt-1 text-xs text-muted">
            One-day addition only. This does not overwrite the member&apos;s recurring MCC transportation schedule.
          </p>
          <TransportationStationAddRiderForm
            action={addTransportationManifestRiderAction}
            selectedDate={manifest.selectedDate}
            defaultShift={selectedShift === "Both" ? "AM" : selectedShift}
            members={addRiderMemberOptions}
            busNumberOptions={busNumberOptions}
          />
        </Card>
      ) : null}

      {groupedByShiftAndDay.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">No riders match this date/shift selection.</p>
        </Card>
      ) : (
        groupedByShiftAndDay.map((shiftGroup) => (
          <Card key={`${shiftGroup.shift}-${shiftGroup.weekdayLabel}`} className="table-wrap">
            <CardTitle>
              {shiftGroup.shift} | {shiftGroup.weekdayLabel} ({formatDate(manifest.selectedDate)})
            </CardTitle>

            <div className="mt-3 space-y-4">
              {shiftGroup.busGroups.map((group) => (
                <div key={`${shiftGroup.shift}-${group.label}`}>
                  <p className="text-sm font-semibold text-primary-text">{group.label}</p>
                  <table className="mt-2">
                    <thead>
                      <tr>
                        <th>Member</th>
                        <th>Shift</th>
                        <th>Transport Type</th>
                        <th>Location</th>
                        <th>Contact</th>
                        <th>Phone</th>
                        <th>Address</th>
                        <th>Source</th>
                        {canEdit ? <th>Actions</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {group.riders.map((rider) => (
                        <tr key={rider.key}>
                          <td>
                            <a href={`/operations/member-command-center/${rider.memberId}?tab=transportation`} className="font-semibold text-brand">
                              {rider.memberName}
                            </a>
                          </td>
                          <td>{rider.shift}</td>
                          <td>{rider.transportType}</td>
                          <td>{rider.locationLabel}</td>
                          <td>{rider.caregiverContactName ?? "-"}</td>
                          <td>{rider.caregiverContactPhone ?? "-"}</td>
                          <td>{rider.caregiverContactAddress ?? "-"}</td>
                          <td>{rider.source === "manual-add" ? "Manual Add" : "Schedule"}</td>
                          {canEdit ? (
                            <td>
                              <div className="flex flex-col gap-2">
                                <form action={reassignTransportationManifestBusAction} className="flex items-center gap-1">
                                  <input type="hidden" name="selectedDate" value={manifest.selectedDate} />
                                  <input type="hidden" name="memberId" value={rider.memberId} />
                                  <input type="hidden" name="shift" value={rider.shift} />
                                  <input type="hidden" name="busFilter" value={busFilter} />
                                  <input type="hidden" name="transportType" value={rider.transportType} />
                                  <input type="hidden" name="busStopName" value={rider.busStopName ?? ""} />
                                  <input type="hidden" name="doorToDoorAddress" value={rider.doorToDoorAddress ?? ""} />
                                  <input type="hidden" name="caregiverContactId" value={rider.caregiverContactId ?? ""} />
                                  <input type="hidden" name="caregiverContactName" value={rider.caregiverContactName ?? ""} />
                                  <input type="hidden" name="caregiverContactPhone" value={rider.caregiverContactPhone ?? ""} />
                                  <input type="hidden" name="caregiverContactAddress" value={rider.caregiverContactAddress ?? ""} />
                                  <input type="hidden" name="notes" value={rider.notes ?? ""} />
                                  <select
                                    name="busNumber"
                                    defaultValue={rider.busNumber ?? ""}
                                    required
                                    className="h-7 rounded-md border border-border px-1 text-xs"
                                  >
                                    <option value="" disabled>
                                      Bus
                                    </option>
                                    {busNumberOptions.map((option) => (
                                      <option key={option} value={option}>
                                        {option}
                                      </option>
                                    ))}
                                  </select>
                                  <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs font-semibold">
                                    Save Bus
                                  </button>
                                </form>

                                {rider.source === "manual-add" && rider.adjustmentId ? (
                                  <form action={undoTransportationManifestAdjustmentAction}>
                                    <input type="hidden" name="adjustmentId" value={rider.adjustmentId} />
                                    <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs font-semibold">
                                      Remove Added Rider
                                    </button>
                                  </form>
                                ) : (
                                  <form action={excludeTransportationManifestRiderAction}>
                                    <input type="hidden" name="selectedDate" value={manifest.selectedDate} />
                                    <input type="hidden" name="memberId" value={rider.memberId} />
                                    <input type="hidden" name="shift" value={rider.shift} />
                                    <input type="hidden" name="busNumber" value={rider.busNumber ?? ""} />
                                    <input type="hidden" name="transportType" value={rider.transportType} />
                                    <input type="hidden" name="busStopName" value={rider.busStopName ?? ""} />
                                    <input type="hidden" name="doorToDoorAddress" value={rider.doorToDoorAddress ?? ""} />
                                    <input type="hidden" name="caregiverContactId" value={rider.caregiverContactId ?? ""} />
                                    <input type="hidden" name="caregiverContactName" value={rider.caregiverContactName ?? ""} />
                                    <input type="hidden" name="caregiverContactPhone" value={rider.caregiverContactPhone ?? ""} />
                                    <input type="hidden" name="caregiverContactAddress" value={rider.caregiverContactAddress ?? ""} />
                                    <button type="submit" className="rounded-md border border-danger px-2 py-1 text-xs font-semibold text-danger">
                                      Exclude
                                    </button>
                                  </form>
                                )}
                              </div>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </Card>
        ))
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="table-wrap">
          <CardTitle>Manual Additions ({manifest.manualAdditions.length})</CardTitle>
          {manifest.manualAdditions.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No manual additions for this date/shift.</p>
          ) : (
            <table className="mt-3">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Shift</th>
                  <th>Bus</th>
                  <th>Created</th>
                  <th>By</th>
                  {canEdit ? <th>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {manifest.manualAdditions.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.memberName}</td>
                    <td>{entry.shift}</td>
                    <td>{entry.busNumber ? `Bus ${entry.busNumber}` : "-"}</td>
                    <td>{formatDateTime(entry.createdAt)}</td>
                    <td>{entry.createdByName}</td>
                    {canEdit ? (
                      <td>
                        <form action={undoTransportationManifestAdjustmentAction}>
                          <input type="hidden" name="adjustmentId" value={entry.id} />
                          <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs font-semibold">
                            Undo
                          </button>
                        </form>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="table-wrap">
          <CardTitle>Exclusions ({manifest.exclusions.length})</CardTitle>
          {manifest.exclusions.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No exclusions for this date/shift.</p>
          ) : (
            <table className="mt-3">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Shift</th>
                  <th>Created</th>
                  <th>By</th>
                  {canEdit ? <th>Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {manifest.exclusions.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.memberName}</td>
                    <td>{entry.shift}</td>
                    <td>{formatDateTime(entry.createdAt)}</td>
                    <td>{entry.createdByName}</td>
                    {canEdit ? (
                      <td>
                        <form action={undoTransportationManifestAdjustmentAction}>
                          <input type="hidden" name="adjustmentId" value={entry.id} />
                          <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs font-semibold">
                            Re-include
                          </button>
                        </form>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {manifest.excludedScheduledRiders.length > 0 ? (
        <Card className="table-wrap">
          <CardTitle>Excluded Scheduled Riders ({manifest.excludedScheduledRiders.length})</CardTitle>
          <table className="mt-3">
            <thead>
              <tr>
                <th>Member</th>
                <th>Shift</th>
                <th>Type</th>
                <th>Location</th>
                <th>Contact</th>
              </tr>
            </thead>
            <tbody>
              {manifest.excludedScheduledRiders.map((row) => (
                <tr key={`excluded-${row.key}`}>
                  <td>{row.memberName}</td>
                  <td>{row.shift}</td>
                  <td>{row.transportType}</td>
                  <td>{row.locationLabel}</td>
                  <td>{row.caregiverContactName ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      {manifest.holdExcludedScheduledRiders.length > 0 ? (
        <Card className="table-wrap">
          <CardTitle>On-Hold Riders Excluded ({manifest.holdExcludedScheduledRiders.length})</CardTitle>
          <table className="mt-3">
            <thead>
              <tr>
                <th>Member</th>
                <th>Shift</th>
                <th>Type</th>
                <th>Location</th>
                <th>Contact</th>
              </tr>
            </thead>
            <tbody>
              {manifest.holdExcludedScheduledRiders.map((row) => (
                <tr key={`hold-excluded-${row.key}`}>
                  <td>{row.memberName}</td>
                  <td>{row.shift}</td>
                  <td>{row.transportType}</td>
                  <td>{row.locationLabel}</td>
                  <td>{row.caregiverContactName ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}
