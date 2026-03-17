import { Card } from "@/components/ui/card";
import { MccTransportationFormShell } from "@/components/forms/member-command-center-shells";
import type { MemberCommandCenterDetail } from "@/app/(portal)/operations/member-command-center/member-command-center-detail-shared";
import { SectionHeading } from "@/app/(portal)/operations/member-command-center/member-command-center-detail-shared";

function formatTransportSlot(
  mode: "Door to Door" | "Bus Stop" | null | undefined,
  doorToDoorAddress: string | null | undefined,
  busNumber: string | null | undefined,
  busStop: string | null | undefined
) {
  if (!mode) return "None";
  if (mode === "Door to Door") return doorToDoorAddress ? `Door to Door - ${doorToDoorAddress}` : "Door to Door";
  if (busNumber && busStop) return `Bus #${busNumber} - ${busStop}`;
  if (busNumber) return `Bus #${busNumber}`;
  if (busStop) return `Bus Stop - ${busStop}`;
  return "Bus Stop";
}

export default function MemberCommandCenterTransportationTab({
  canEdit,
  detail,
  scheduleUpdatedAt,
  scheduleUpdatedBy,
  transportationSummary,
  configuredTransportTrips,
  expectedTransportSlots,
  defaultDoorToDoorAddress,
  busNumberOptions
}: {
  canEdit: boolean;
  detail: MemberCommandCenterDetail;
  scheduleUpdatedAt: string | null;
  scheduleUpdatedBy: string | null;
  transportationSummary: string;
  configuredTransportTrips: number;
  expectedTransportSlots: number;
  defaultDoorToDoorAddress: string;
  busNumberOptions: string[];
}) {
  return (
    <Card id="transportation">
      <SectionHeading title="Transportation" lastUpdatedAt={scheduleUpdatedAt} lastUpdatedBy={scheduleUpdatedBy} />

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted">Transportation</p>
          <p className="font-semibold">{detail.schedule?.transportation_required == null ? "-" : detail.schedule.transportation_required ? "Yes" : "No"}</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted">Transport Type</p>
          <p className="font-semibold">{transportationSummary}</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs text-muted">Configured Trips</p>
          <p className="font-semibold">{configuredTransportTrips} / {expectedTransportSlots}</p>
        </div>
      </div>

      <div className="mt-3 grid gap-3 text-sm md:grid-cols-5">
        {detail.schedule?.monday ? (
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Monday</p>
            <p className="font-semibold">AM: {formatTransportSlot(detail.schedule.transport_monday_am_mode, detail.schedule.transport_monday_am_door_to_door_address, detail.schedule.transport_monday_am_bus_number, detail.schedule.transport_monday_am_bus_stop)}</p>
            <p className="font-semibold">PM: {formatTransportSlot(detail.schedule.transport_monday_pm_mode, detail.schedule.transport_monday_pm_door_to_door_address, detail.schedule.transport_monday_pm_bus_number, detail.schedule.transport_monday_pm_bus_stop)}</p>
          </div>
        ) : null}
        {detail.schedule?.tuesday ? (
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Tuesday</p>
            <p className="font-semibold">AM: {formatTransportSlot(detail.schedule.transport_tuesday_am_mode, detail.schedule.transport_tuesday_am_door_to_door_address, detail.schedule.transport_tuesday_am_bus_number, detail.schedule.transport_tuesday_am_bus_stop)}</p>
            <p className="font-semibold">PM: {formatTransportSlot(detail.schedule.transport_tuesday_pm_mode, detail.schedule.transport_tuesday_pm_door_to_door_address, detail.schedule.transport_tuesday_pm_bus_number, detail.schedule.transport_tuesday_pm_bus_stop)}</p>
          </div>
        ) : null}
        {detail.schedule?.wednesday ? (
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Wednesday</p>
            <p className="font-semibold">AM: {formatTransportSlot(detail.schedule.transport_wednesday_am_mode, detail.schedule.transport_wednesday_am_door_to_door_address, detail.schedule.transport_wednesday_am_bus_number, detail.schedule.transport_wednesday_am_bus_stop)}</p>
            <p className="font-semibold">PM: {formatTransportSlot(detail.schedule.transport_wednesday_pm_mode, detail.schedule.transport_wednesday_pm_door_to_door_address, detail.schedule.transport_wednesday_pm_bus_number, detail.schedule.transport_wednesday_pm_bus_stop)}</p>
          </div>
        ) : null}
        {detail.schedule?.thursday ? (
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Thursday</p>
            <p className="font-semibold">AM: {formatTransportSlot(detail.schedule.transport_thursday_am_mode, detail.schedule.transport_thursday_am_door_to_door_address, detail.schedule.transport_thursday_am_bus_number, detail.schedule.transport_thursday_am_bus_stop)}</p>
            <p className="font-semibold">PM: {formatTransportSlot(detail.schedule.transport_thursday_pm_mode, detail.schedule.transport_thursday_pm_door_to_door_address, detail.schedule.transport_thursday_pm_bus_number, detail.schedule.transport_thursday_pm_bus_stop)}</p>
          </div>
        ) : null}
        {detail.schedule?.friday ? (
          <div className="rounded-lg border border-border p-3">
            <p className="text-xs text-muted">Friday</p>
            <p className="font-semibold">AM: {formatTransportSlot(detail.schedule.transport_friday_am_mode, detail.schedule.transport_friday_am_door_to_door_address, detail.schedule.transport_friday_am_bus_number, detail.schedule.transport_friday_am_bus_stop)}</p>
            <p className="font-semibold">PM: {formatTransportSlot(detail.schedule.transport_friday_pm_mode, detail.schedule.transport_friday_pm_door_to_door_address, detail.schedule.transport_friday_pm_bus_number, detail.schedule.transport_friday_pm_bus_stop)}</p>
          </div>
        ) : null}
      </div>

      {canEdit && detail.schedule ? (
        <MccTransportationFormShell
          key={`mcc-transport-${detail.member.id}-${scheduleUpdatedAt ?? "na"}`}
          memberId={detail.member.id}
          transportationRequired={detail.schedule.transportation_required}
          defaultDoorToDoorAddress={defaultDoorToDoorAddress}
          monday={detail.schedule.monday}
          tuesday={detail.schedule.tuesday}
          wednesday={detail.schedule.wednesday}
          thursday={detail.schedule.thursday}
          friday={detail.schedule.friday}
          transportMondayAmMode={detail.schedule.transport_monday_am_mode}
          transportMondayAmDoorToDoorAddress={detail.schedule.transport_monday_am_door_to_door_address}
          transportMondayAmBusNumber={detail.schedule.transport_monday_am_bus_number}
          transportMondayAmBusStop={detail.schedule.transport_monday_am_bus_stop}
          transportMondayPmMode={detail.schedule.transport_monday_pm_mode}
          transportMondayPmDoorToDoorAddress={detail.schedule.transport_monday_pm_door_to_door_address}
          transportMondayPmBusNumber={detail.schedule.transport_monday_pm_bus_number}
          transportMondayPmBusStop={detail.schedule.transport_monday_pm_bus_stop}
          transportTuesdayAmMode={detail.schedule.transport_tuesday_am_mode}
          transportTuesdayAmDoorToDoorAddress={detail.schedule.transport_tuesday_am_door_to_door_address}
          transportTuesdayAmBusNumber={detail.schedule.transport_tuesday_am_bus_number}
          transportTuesdayAmBusStop={detail.schedule.transport_tuesday_am_bus_stop}
          transportTuesdayPmMode={detail.schedule.transport_tuesday_pm_mode}
          transportTuesdayPmDoorToDoorAddress={detail.schedule.transport_tuesday_pm_door_to_door_address}
          transportTuesdayPmBusNumber={detail.schedule.transport_tuesday_pm_bus_number}
          transportTuesdayPmBusStop={detail.schedule.transport_tuesday_pm_bus_stop}
          transportWednesdayAmMode={detail.schedule.transport_wednesday_am_mode}
          transportWednesdayAmDoorToDoorAddress={detail.schedule.transport_wednesday_am_door_to_door_address}
          transportWednesdayAmBusNumber={detail.schedule.transport_wednesday_am_bus_number}
          transportWednesdayAmBusStop={detail.schedule.transport_wednesday_am_bus_stop}
          transportWednesdayPmMode={detail.schedule.transport_wednesday_pm_mode}
          transportWednesdayPmDoorToDoorAddress={detail.schedule.transport_wednesday_pm_door_to_door_address}
          transportWednesdayPmBusNumber={detail.schedule.transport_wednesday_pm_bus_number}
          transportWednesdayPmBusStop={detail.schedule.transport_wednesday_pm_bus_stop}
          transportThursdayAmMode={detail.schedule.transport_thursday_am_mode}
          transportThursdayAmDoorToDoorAddress={detail.schedule.transport_thursday_am_door_to_door_address}
          transportThursdayAmBusNumber={detail.schedule.transport_thursday_am_bus_number}
          transportThursdayAmBusStop={detail.schedule.transport_thursday_am_bus_stop}
          transportThursdayPmMode={detail.schedule.transport_thursday_pm_mode}
          transportThursdayPmDoorToDoorAddress={detail.schedule.transport_thursday_pm_door_to_door_address}
          transportThursdayPmBusNumber={detail.schedule.transport_thursday_pm_bus_number}
          transportThursdayPmBusStop={detail.schedule.transport_thursday_pm_bus_stop}
          transportFridayAmMode={detail.schedule.transport_friday_am_mode}
          transportFridayAmDoorToDoorAddress={detail.schedule.transport_friday_am_door_to_door_address}
          transportFridayAmBusNumber={detail.schedule.transport_friday_am_bus_number}
          transportFridayAmBusStop={detail.schedule.transport_friday_am_bus_stop}
          transportFridayPmMode={detail.schedule.transport_friday_pm_mode}
          transportFridayPmDoorToDoorAddress={detail.schedule.transport_friday_pm_door_to_door_address}
          transportFridayPmBusNumber={detail.schedule.transport_friday_pm_bus_number}
          transportFridayPmBusStop={detail.schedule.transport_friday_pm_bus_stop}
          busStopOptions={detail.busStopDirectory.map((entry) => entry.bus_stop_name)}
          busNumberOptions={busNumberOptions}
        />
      ) : null}
    </Card>
  );
}
