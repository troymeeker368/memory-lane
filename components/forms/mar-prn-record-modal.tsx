"use client";

import { useMemo, useState } from "react";

import {
  createPrnOrderAndAdministrationAction,
  recordPrnMarAdministrationAction
} from "@/app/(portal)/health/mar/administration-actions";
import { MhpEditModal } from "@/components/forms/mhp-edit-modal";
import { usePropSyncedState } from "@/components/forms/use-prop-synced-state";
import { useScopedMutation } from "@/components/forms/use-scoped-mutation";
import type { MarPrnOption, MarPrnStatus } from "@/lib/services/mar-shared";
import { MAR_PRN_STATUS_OPTIONS } from "@/lib/services/mar-shared";
import { toEasternDate, toEasternDateTimeLocal } from "@/lib/timezone";

function addMinutes(dateTimeLocal: string, minutes: number) {
  const parsed = new Date(dateTimeLocal);
  if (Number.isNaN(parsed.getTime())) return toEasternDateTimeLocal();
  parsed.setMinutes(parsed.getMinutes() + minutes);
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}T${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}`;
}

function toIso(dateTimeLocal: string) {
  const parsed = new Date(dateTimeLocal);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

export function MarPrnRecordModal({
  open,
  onClose,
  canDocument,
  memberOptions,
  orderOptions,
  defaultMemberId,
  onSaved,
  onStatusMessage
}: {
  open: boolean;
  onClose: () => void;
  canDocument: boolean;
  memberOptions: Array<{ memberId: string; memberName: string }>;
  orderOptions: MarPrnOption[];
  defaultMemberId?: string | null;
  onSaved: (option: MarPrnOption, data: {
    administrationId: string;
    administeredAt: string;
    administeredBy: string;
    indication: string;
    status: MarPrnStatus;
    doseGiven: string | null;
    routeGiven: string | null;
    followupDueAt: string | null;
    followupStatus: string | null;
    notes: string | null;
  }) => void;
  onStatusMessage: (message: string) => void;
}) {
  const { isSaving, run } = useScopedMutation();
  const [tab, setTab] = useState<"standing" | "new">("standing");
  const [search, setSearch] = useState("");
  const memberOptionsKey = useMemo(
    () => memberOptions.map((option) => `${option.memberId}:${option.memberName}`).join("|"),
    [memberOptions]
  );
  const [memberId, setMemberId] = usePropSyncedState(defaultMemberId ?? memberOptions[0]?.memberId ?? "", [
    open,
    defaultMemberId ?? "",
    memberOptionsKey
  ]);
  const [selectedOrderId, setSelectedOrderId] = usePropSyncedState("", [open, memberId, search]);

  const [adminDateTime, setAdminDateTime] = useState(() => toEasternDateTimeLocal());
  const [adminStatus, setAdminStatus] = useState<MarPrnStatus>("Given");
  const [indication, setIndication] = useState("");
  const [symptomScoreBefore, setSymptomScoreBefore] = useState("");
  const [notes, setNotes] = useState("");

  const [newMedicationName, setNewMedicationName] = useState("");
  const [newStrength, setNewStrength] = useState("");
  const [newForm, setNewForm] = useState("");
  const [newRoute, setNewRoute] = useState("");
  const [newDirections, setNewDirections] = useState("");
  const [newPrnReason, setNewPrnReason] = useState("");
  const [newFrequencyText, setNewFrequencyText] = useState("");
  const [newMinIntervalMinutes, setNewMinIntervalMinutes] = useState("");
  const [newMaxDosesPer24h, setNewMaxDosesPer24h] = useState("");
  const [newMaxDailyDose, setNewMaxDailyDose] = useState("");
  const [newStartDate, setNewStartDate] = useState(() => toEasternDate());
  const [newEndDate, setNewEndDate] = useState("");
  const [newProviderName, setNewProviderName] = useState("");
  const [requiresReview, setRequiresReview] = useState(true);
  const [requiresEffectivenessFollowup, setRequiresEffectivenessFollowup] = useState(true);

  const filteredOrders = useMemo(() => {
    const query = search.trim().toLowerCase();
    return orderOptions.filter((option) => {
      const memberMatches = !memberId || option.memberId === memberId;
      if (!memberMatches) return false;
      if (!query) return true;
      return [
        option.memberName,
        option.medicationName,
        option.prnReason,
        option.providerName,
        option.directions
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [memberId, orderOptions, search]);

  const activeSelectedOrderId =
    filteredOrders.find((option) => option.medicationOrderId === selectedOrderId)?.medicationOrderId ??
    filteredOrders[0]?.medicationOrderId ??
    "";
  const selectedOrder = filteredOrders.find((option) => option.medicationOrderId === activeSelectedOrderId) ?? null;
  const [doseGiven, setDoseGiven] = usePropSyncedState(selectedOrder?.strength ?? "", [activeSelectedOrderId]);
  const [routeGiven, setRouteGiven] = usePropSyncedState(selectedOrder?.route ?? "", [activeSelectedOrderId]);
  const [followupDueAt, setFollowupDueAt] = usePropSyncedState(
    () =>
      adminStatus === "Given" && selectedOrder?.requiresEffectivenessFollowup
        ? addMinutes(adminDateTime, 60)
        : "",
    [adminDateTime, adminStatus, activeSelectedOrderId, selectedOrder?.requiresEffectivenessFollowup ? "1" : "0"]
  );

  function resetAdministrationFields() {
    setAdminDateTime(toEasternDateTimeLocal());
    setAdminStatus("Given");
    setDoseGiven(selectedOrder?.strength ?? "");
    setRouteGiven(selectedOrder?.route ?? "");
    setIndication("");
    setSymptomScoreBefore("");
    setFollowupDueAt(selectedOrder?.requiresEffectivenessFollowup ? addMinutes(toEasternDateTimeLocal(), 60) : "");
    setNotes("");
  }

  function resetNewOrderFields() {
    setNewMedicationName("");
    setNewStrength("");
    setNewForm("");
    setNewRoute("");
    setNewDirections("");
    setNewPrnReason("");
    setNewFrequencyText("");
    setNewMinIntervalMinutes("");
    setNewMaxDosesPer24h("");
    setNewMaxDailyDose("");
    setNewStartDate(toEasternDate());
    setNewEndDate("");
    setNewProviderName("");
    setRequiresReview(true);
    setRequiresEffectivenessFollowup(true);
  }

  return (
    <MhpEditModal open={open} title="Record PRN" onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-slate-50 p-1">
          <div className="grid grid-cols-2 gap-1">
            <button type="button" className={`rounded-lg px-3 py-2 text-sm font-semibold ${tab === "standing" ? "bg-white shadow-sm" : "text-muted"}`} onClick={() => setTab("standing")}>
              Standing PRNs
            </button>
            <button type="button" className={`rounded-lg px-3 py-2 text-sm font-semibold ${tab === "new" ? "bg-white shadow-sm" : "text-muted"}`} onClick={() => setTab("new")}>
              Add New PRN Order
            </button>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_220px]">
          <input
            className="h-10 rounded-lg border border-border px-3 text-sm"
            placeholder="Search member, medication, reason, provider"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select className="h-10 rounded-lg border border-border px-3 text-sm" value={memberId} onChange={(event) => setMemberId(event.target.value)}>
            {memberOptions.map((option) => (
              <option key={option.memberId} value={option.memberId}>
                {option.memberName}
              </option>
            ))}
          </select>
        </div>

        {tab === "standing" ? (
          <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
              {filteredOrders.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted">No active PRN orders match this member/filter.</div>
              ) : (
                filteredOrders.map((option) => (
                  <button
                    key={option.medicationOrderId}
                    type="button"
                    className={`w-full rounded-lg border p-3 text-left ${activeSelectedOrderId === option.medicationOrderId ? "border-brand bg-brand/5" : "border-border"}`}
                    onClick={() => {
                      setSelectedOrderId(option.medicationOrderId);
                    }}
                  >
                    <p className="text-sm font-semibold">{option.medicationName}</p>
                    <p className="text-xs text-muted">{option.memberName} | {option.orderSource === "pof" ? "POF" : option.orderSource === "manual_provider_order" ? "Manual PRN" : "Legacy PRN"}</p>
                    {option.prnReason ? <p className="mt-1 text-xs text-muted">PRN reason: {option.prnReason}</p> : null}
                    {option.providerName ? <p className="text-xs text-muted">Provider: {option.providerName}</p> : null}
                  </button>
                ))
              )}
            </div>

            <div className="rounded-xl border border-border p-4">
              {selectedOrder ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-semibold">{selectedOrder.medicationName}</p>
                    <p className="text-xs text-muted">{selectedOrder.memberName} | {selectedOrder.strength ?? "Dose not listed"} | {selectedOrder.route ?? "Route not listed"}</p>
                    {selectedOrder.directions ? <p className="mt-1 text-xs text-muted">Directions: {selectedOrder.directions}</p> : null}
                    {selectedOrder.minIntervalMinutes ? <p className="text-xs text-muted">Minimum interval: {selectedOrder.minIntervalMinutes} minutes</p> : null}
                    {selectedOrder.maxDosesPer24h ? <p className="text-xs text-muted">Max doses / 24h: {selectedOrder.maxDosesPer24h}</p> : null}
                    {selectedOrder.maxDailyDose ? <p className="text-xs text-muted">Max daily dose: {selectedOrder.maxDailyDose}</p> : null}
                    {selectedOrder.requiresReview ? <p className="text-xs text-amber-700">This order is flagged for review.</p> : null}
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <input type="datetime-local" className="h-10 rounded-lg border border-border px-3 text-sm" value={adminDateTime} onChange={(event) => setAdminDateTime(event.target.value)} />
                    <select className="h-10 rounded-lg border border-border px-3 text-sm" value={adminStatus} onChange={(event) => setAdminStatus(event.target.value as MarPrnStatus)}>
                      {MAR_PRN_STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>{status}</option>
                      ))}
                    </select>
                    <input className="h-10 rounded-lg border border-border px-3 text-sm" placeholder="Dose given" value={doseGiven} onChange={(event) => setDoseGiven(event.target.value)} />
                    <input className="h-10 rounded-lg border border-border px-3 text-sm" placeholder="Route given" value={routeGiven} onChange={(event) => setRouteGiven(event.target.value)} />
                    <input className="h-10 rounded-lg border border-border px-3 text-sm md:col-span-2" placeholder="Indication / symptom (required)" value={indication} onChange={(event) => setIndication(event.target.value)} />
                    <input className="h-10 rounded-lg border border-border px-3 text-sm" placeholder="Symptom score before (0-10)" value={symptomScoreBefore} onChange={(event) => setSymptomScoreBefore(event.target.value)} />
                    <input type="datetime-local" className="h-10 rounded-lg border border-border px-3 text-sm disabled:bg-slate-50" value={followupDueAt} onChange={(event) => setFollowupDueAt(event.target.value)} disabled={adminStatus !== "Given" || !selectedOrder.requiresEffectivenessFollowup} />
                    <textarea className="min-h-[90px] rounded-lg border border-border px-3 py-2 text-sm md:col-span-2" placeholder="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
                  </div>

                  <button
                    type="button"
                    disabled={isSaving || !canDocument || !indication.trim()}
                    className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                    onClick={() =>
                      void run(
                        async () =>
                          recordPrnMarAdministrationAction({
                            medicationOrderId: selectedOrder.medicationOrderId,
                            indication,
                            status: adminStatus,
                            doseGiven,
                            routeGiven,
                            symptomScoreBefore: symptomScoreBefore ? Number(symptomScoreBefore) : null,
                            followupDueAtIso: adminStatus === "Given" && selectedOrder.requiresEffectivenessFollowup && followupDueAt ? toIso(followupDueAt) : null,
                            notes,
                            administeredAtIso: toIso(adminDateTime),
                            submissionId: `${selectedOrder.medicationOrderId}-${Date.now()}`
                          }),
                        {
                          successMessage: "PRN administration saved.",
                          fallbackData: {
                            administrationId: "",
                            administeredAt: "",
                            administeredBy: "",
                            indication: "",
                            status: adminStatus,
                            doseGiven: null as string | null,
                            routeGiven: null as string | null,
                            followupDueAt: null as string | null,
                            followupStatus: null as string | null,
                            orderOption: selectedOrder,
                            notes: null as string | null
                          },
                          onSuccess: async (result) => {
                            onSaved(result.data.orderOption, {
                              administrationId: result.data.administrationId,
                              administeredAt: result.data.administeredAt,
                              administeredBy: result.data.administeredBy,
                              indication: result.data.indication,
                              status: result.data.status,
                              doseGiven: result.data.doseGiven,
                              routeGiven: result.data.routeGiven,
                              followupDueAt: result.data.followupDueAt,
                              followupStatus: result.data.followupStatus,
                              notes: result.data.notes
                            });
                            onStatusMessage(result.message);
                            resetAdministrationFields();
                            onClose();
                          },
                          onError: async (result) => {
                            onStatusMessage(`Error: ${result.error}`);
                          }
                        }
                      )
                    }
                  >
                    Save PRN Administration
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="space-y-4 rounded-xl border border-border p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <input className="h-10 rounded-lg border border-border px-3 text-sm" placeholder="Medication name" value={newMedicationName} onChange={(event) => setNewMedicationName(event.target.value)} />
              <input className="h-10 rounded-lg border border-border px-3 text-sm" placeholder="Provider name" value={newProviderName} onChange={(event) => setNewProviderName(event.target.value)} />
              <input className="h-10 rounded-lg border border-border px-3 text-sm" placeholder="Strength / dose" value={newStrength} onChange={(event) => setNewStrength(event.target.value)} />
              <input className="h-10 rounded-lg border border-border px-3 text-sm" placeholder="Form" value={newForm} onChange={(event) => setNewForm(event.target.value)} />
              <input className="h-10 rounded-lg border border-border px-3 text-sm" placeholder="Route" value={newRoute} onChange={(event) => setNewRoute(event.target.value)} />
              <input className="h-10 rounded-lg border border-border px-3 text-sm" placeholder="PRN reason" value={newPrnReason} onChange={(event) => setNewPrnReason(event.target.value)} />
              <input className="h-10 rounded-lg border border-border px-3 text-sm" placeholder="Frequency text" value={newFrequencyText} onChange={(event) => setNewFrequencyText(event.target.value)} />
              <input className="h-10 rounded-lg border border-border px-3 text-sm" placeholder="Min interval minutes" value={newMinIntervalMinutes} onChange={(event) => setNewMinIntervalMinutes(event.target.value)} />
              <input className="h-10 rounded-lg border border-border px-3 text-sm" placeholder="Max doses / 24h" value={newMaxDosesPer24h} onChange={(event) => setNewMaxDosesPer24h(event.target.value)} />
              <input className="h-10 rounded-lg border border-border px-3 text-sm" placeholder="Max daily dose" value={newMaxDailyDose} onChange={(event) => setNewMaxDailyDose(event.target.value)} />
              <input type="date" className="h-10 rounded-lg border border-border px-3 text-sm" value={newStartDate} onChange={(event) => setNewStartDate(event.target.value)} />
              <input type="date" className="h-10 rounded-lg border border-border px-3 text-sm" value={newEndDate} onChange={(event) => setNewEndDate(event.target.value)} />
              <textarea className="min-h-[90px] rounded-lg border border-border px-3 py-2 text-sm md:col-span-2" placeholder="Directions / physician order text" value={newDirections} onChange={(event) => setNewDirections(event.target.value)} />
            </div>

            <div className="flex flex-wrap gap-4 text-sm">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={requiresReview} onChange={(event) => setRequiresReview(event.target.checked)} />
                Flag for review
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={requiresEffectivenessFollowup} onChange={(event) => setRequiresEffectivenessFollowup(event.target.checked)} />
                Require effectiveness follow-up
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <input type="datetime-local" className="h-10 rounded-lg border border-border px-3 text-sm" value={adminDateTime} onChange={(event) => setAdminDateTime(event.target.value)} />
              <select className="h-10 rounded-lg border border-border px-3 text-sm" value={adminStatus} onChange={(event) => setAdminStatus(event.target.value as MarPrnStatus)}>
                {MAR_PRN_STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
              <input className="h-10 rounded-lg border border-border px-3 text-sm" placeholder="Dose given" value={doseGiven} onChange={(event) => setDoseGiven(event.target.value)} />
              <input className="h-10 rounded-lg border border-border px-3 text-sm" placeholder="Route given" value={routeGiven} onChange={(event) => setRouteGiven(event.target.value)} />
              <input className="h-10 rounded-lg border border-border px-3 text-sm md:col-span-2" placeholder="Indication / symptom (required)" value={indication} onChange={(event) => setIndication(event.target.value)} />
              <input className="h-10 rounded-lg border border-border px-3 text-sm" placeholder="Symptom score before (0-10)" value={symptomScoreBefore} onChange={(event) => setSymptomScoreBefore(event.target.value)} />
              <input type="datetime-local" className="h-10 rounded-lg border border-border px-3 text-sm disabled:bg-slate-50" value={followupDueAt} onChange={(event) => setFollowupDueAt(event.target.value)} disabled={adminStatus !== "Given" || !requiresEffectivenessFollowup} />
              <textarea className="min-h-[90px] rounded-lg border border-border px-3 py-2 text-sm md:col-span-2" placeholder="Administration notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
            </div>

            <button
              type="button"
              disabled={isSaving || !canDocument || !memberId || !newMedicationName.trim() || !newProviderName.trim() || !newDirections.trim() || !indication.trim()}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              onClick={() =>
                void run(
                  async () =>
                    createPrnOrderAndAdministrationAction({
                      memberId,
                      medicationName: newMedicationName,
                      strength: newStrength,
                      form: newForm,
                      route: newRoute,
                      directions: newDirections,
                      prnReason: newPrnReason,
                      frequencyText: newFrequencyText,
                      minIntervalMinutes: newMinIntervalMinutes ? Number(newMinIntervalMinutes) : null,
                      maxDosesPer24h: newMaxDosesPer24h ? Number(newMaxDosesPer24h) : null,
                      maxDailyDose: newMaxDailyDose,
                      startDate: newStartDate,
                      endDate: newEndDate || null,
                      providerName: newProviderName,
                      requiresReview,
                      requiresEffectivenessFollowup,
                      indication,
                      status: adminStatus,
                      doseGiven,
                      routeGiven,
                      symptomScoreBefore: symptomScoreBefore ? Number(symptomScoreBefore) : null,
                      followupDueAtIso: adminStatus === "Given" && requiresEffectivenessFollowup && followupDueAt ? toIso(followupDueAt) : null,
                      notes,
                      administeredAtIso: toIso(adminDateTime),
                      submissionId: `${memberId}-${Date.now()}`
                    }),
                  {
                    successMessage: "PRN order saved and administration documented.",
                    fallbackData: {
                      medicationOrderId: "",
                      administrationId: "",
                      memberId,
                      administeredAt: "",
                      administeredBy: "",
                      indication,
                      status: adminStatus,
                      followupDueAt: null as string | null,
                      followupStatus: null as string | null,
                      orderOption: null as unknown as MarPrnOption,
                      notes: null as string | null
                    },
                    onSuccess: async (result) => {
                      onSaved(result.data.orderOption, {
                        administrationId: result.data.administrationId,
                        administeredAt: result.data.administeredAt,
                        administeredBy: result.data.administeredBy,
                        indication: result.data.indication,
                        status: result.data.status,
                        doseGiven,
                        routeGiven,
                        followupDueAt: result.data.followupDueAt,
                        followupStatus: result.data.followupStatus,
                        notes: result.data.notes
                      });
                      onStatusMessage(result.message);
                      resetAdministrationFields();
                      resetNewOrderFields();
                      onClose();
                    },
                    onError: async (result) => {
                      onStatusMessage(`Error: ${result.error}`);
                    }
                  }
                )
              }
            >
              Save & Administer
            </button>
          </div>
        )}
      </div>
    </MhpEditModal>
  );
}
