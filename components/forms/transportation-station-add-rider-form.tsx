"use client";

import { useMemo, useState, useTransition } from "react";

import { copyForwardTransportationDetailsAction } from "@/app/(portal)/operations/transportation-station/actions";
import { usePropSyncedState, usePropSyncedStatus } from "@/components/forms/use-prop-synced-state";
import { formatPhoneInput } from "@/lib/phone";

type ShiftOption = "AM" | "PM" | "Both";
type TransportType = "Door to Door" | "Bus Stop";
type BusNumber = string;

interface MemberPrefillOption {
  id: string;
  displayName: string;
  defaultDoorToDoorAddress: string | null;
  defaultContactId: string | null;
  defaultContactName: string | null;
  defaultContactPhone: string | null;
  defaultContactAddress: string | null;
}

export function TransportationStationAddRiderForm({
  action,
  selectedDate,
  defaultShift,
  members,
  busNumberOptions
}: {
  action: (formData: FormData) => void | Promise<void>;
  selectedDate: string;
  defaultShift: ShiftOption;
  members: MemberPrefillOption[];
  busNumberOptions: string[];
}) {
  const previousDateDefault = useMemo(() => {
    const parsed = new Date(`${selectedDate}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) return selectedDate;
    parsed.setUTCDate(parsed.getUTCDate() - 1);
    return parsed.toISOString().slice(0, 10);
  }, [selectedDate]);
  const [isCopyPending, startCopyTransition] = useTransition();
  const [memberId, setMemberId] = useState("");
  const [shift, setShift] = usePropSyncedState<ShiftOption>(defaultShift, [defaultShift, selectedDate]);
  const [copySourceDate, setCopySourceDate] = usePropSyncedState(previousDateDefault, [previousDateDefault]);
  const [transportType, setTransportType] = useState<TransportType>("Door to Door");
  const [busNumber, setBusNumber] = useState<BusNumber>("");
  const [busStopName, setBusStopName] = useState("");
  const [doorToDoorAddress, setDoorToDoorAddress] = useState("");
  const [caregiverContactName, setCaregiverContactName] = useState("");
  const [caregiverContactPhone, setCaregiverContactPhone] = useState("");
  const [caregiverContactAddress, setCaregiverContactAddress] = useState("");
  const [copyStatus, setCopyStatus] = usePropSyncedStatus([selectedDate, defaultShift], "");

  const selectedMember = useMemo(() => members.find((row) => row.id === memberId) ?? null, [members, memberId]);
  const activeMemberId = selectedMember?.id ?? "";

  const setMemberWithPrefills = (nextMemberId: string) => {
    setMemberId(nextMemberId);
    const nextMember = members.find((row) => row.id === nextMemberId) ?? null;
    setDoorToDoorAddress(nextMember?.defaultDoorToDoorAddress ?? "");
    setCaregiverContactName(nextMember?.defaultContactName ?? "");
    setCaregiverContactPhone(formatPhoneInput(nextMember?.defaultContactPhone));
    setCaregiverContactAddress(nextMember?.defaultContactAddress ?? "");
  };

  const setTransportTypeWithVisibility = (nextType: TransportType) => {
    setTransportType(nextType);
    if (nextType === "Bus Stop") {
      setDoorToDoorAddress("");
      return;
    }

    setBusStopName("");
    if (!doorToDoorAddress.trim()) {
      setDoorToDoorAddress(selectedMember?.defaultDoorToDoorAddress ?? "");
    }
  };

  const applyCopyForward = () => {
    if (!memberId) {
      setCopyStatus("Select a member first.");
      return;
    }
    const effectiveShift = shift === "Both" ? "AM" : shift;
    startCopyTransition(async () => {
      setCopyStatus("");
      const payload = new FormData();
      payload.set("memberId", activeMemberId);
      payload.set("sourceDate", copySourceDate);
      payload.set("targetDate", selectedDate);
      payload.set("shift", effectiveShift);
      const result = await copyForwardTransportationDetailsAction(payload);
      if (!result.ok) {
        setCopyStatus(result.error ?? "Unable to copy transport details.");
        return;
      }

      const snapshot = result.snapshot;
      setTransportType(snapshot.transportType);
      setBusNumber(snapshot.busNumber);
      setBusStopName(snapshot.busStopName);
      setDoorToDoorAddress(snapshot.doorToDoorAddress || selectedMember?.defaultDoorToDoorAddress || "");
      setCaregiverContactName(snapshot.caregiverContactName || selectedMember?.defaultContactName || "");
      setCaregiverContactPhone(formatPhoneInput(snapshot.caregiverContactPhone || selectedMember?.defaultContactPhone || ""));
      setCaregiverContactAddress(snapshot.caregiverContactAddress || selectedMember?.defaultContactAddress || "");
      setCopyStatus(result.unchanged ? "Current manifest already matches copied transport details." : "Transport details copied. You can edit before saving.");
    });
  };

  return (
    <form action={action} className="mt-3 grid gap-2 md:grid-cols-3">
      <input type="hidden" name="selectedDate" value={selectedDate} />
      <input type="hidden" name="caregiverContactId" value={selectedMember?.defaultContactId ?? ""} />

      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Member</span>
        <select
          name="memberId"
          required
          value={activeMemberId}
          onChange={(event) => setMemberWithPrefills(event.target.value)}
          className="h-10 w-full rounded-lg border border-border px-3"
        >
          <option value="">Select member</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.displayName}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Shift</span>
        <select
          name="shift"
          value={shift}
          onChange={(event) => setShift(event.target.value as ShiftOption)}
          className="h-10 w-full rounded-lg border border-border px-3"
        >
          <option value="AM">AM</option>
          <option value="PM">PM</option>
          <option value="Both">Both</option>
        </select>
      </label>

      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Copy From Date</span>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={copySourceDate}
            onChange={(event) => setCopySourceDate(event.target.value)}
            className="h-10 w-full rounded-lg border border-border px-3"
          />
          <button
            type="button"
            onClick={applyCopyForward}
            disabled={isCopyPending}
            className="h-10 rounded-lg border border-border px-3 text-xs font-semibold"
          >
            {isCopyPending ? "Copying..." : "Copy"}
          </button>
        </div>
      </label>

      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Transport Type</span>
        <select
          name="transportType"
          value={transportType}
          onChange={(event) => setTransportTypeWithVisibility(event.target.value as TransportType)}
          className="h-10 w-full rounded-lg border border-border px-3"
        >
          <option value="Door to Door">Door to Door</option>
          <option value="Bus Stop">Bus Stop</option>
        </select>
      </label>

      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Bus #</span>
        <select
          name="busNumber"
          required
          value={busNumber}
          onChange={(event) => setBusNumber(event.target.value as BusNumber)}
          className="h-10 w-full rounded-lg border border-border px-3"
        >
          <option value="">Select bus</option>
          {busNumberOptions.map((option) => (
            <option key={option} value={option}>
              Bus {option}
            </option>
          ))}
        </select>
      </label>

      {transportType === "Door to Door" ? (
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="text-xs font-semibold text-muted">Door-to-Door Address</span>
          <input
            name="doorToDoorAddress"
            required
            value={doorToDoorAddress}
            onChange={(event) => setDoorToDoorAddress(event.target.value)}
            className="h-10 w-full rounded-lg border border-border px-3"
          />
        </label>
      ) : (
        <label className="space-y-1 text-sm md:col-span-2">
          <span className="text-xs font-semibold text-muted">Bus Stop Name</span>
          <input
            name="busStopName"
            required
            value={busStopName}
            onChange={(event) => setBusStopName(event.target.value)}
            className="h-10 w-full rounded-lg border border-border px-3"
          />
        </label>
      )}

      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Contact Name</span>
        <input
          name="caregiverContactName"
          value={caregiverContactName}
          onChange={(event) => setCaregiverContactName(event.target.value)}
          className="h-10 w-full rounded-lg border border-border px-3"
        />
      </label>

      <label className="space-y-1 text-sm">
        <span className="text-xs font-semibold text-muted">Contact Phone</span>
        <input
          name="caregiverContactPhone"
          value={caregiverContactPhone}
          onChange={(event) => setCaregiverContactPhone(formatPhoneInput(event.target.value))}
          className="h-10 w-full rounded-lg border border-border px-3"
        />
      </label>

      <label className="space-y-1 text-sm md:col-span-1">
        <span className="text-xs font-semibold text-muted">Contact Address</span>
        <input
          name="caregiverContactAddress"
          value={caregiverContactAddress}
          onChange={(event) => setCaregiverContactAddress(event.target.value)}
          className="h-10 w-full rounded-lg border border-border px-3"
        />
      </label>

      <label className="space-y-1 text-sm md:col-span-2">
        <span className="text-xs font-semibold text-muted">Notes</span>
        <input name="notes" className="h-10 w-full rounded-lg border border-border px-3" />
      </label>

      <div className="md:col-span-3">
        <button type="submit" className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white">
          Add Rider
        </button>
      </div>
      {copyStatus ? <p className="md:col-span-3 text-xs text-muted">{copyStatus}</p> : null}
    </form>
  );
}
