"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  amendIncidentAction,
  closeIncidentAction,
  reviewIncidentAction,
  saveIncidentDraftAction,
  submitIncidentAction
} from "@/app/(portal)/documentation/incidents/actions";
import { useScopedMutation } from "@/components/forms/use-scoped-mutation";
import { MutationNotice } from "@/components/ui/mutation-notice";
import { IncidentPdfActions } from "@/components/incidents/incident-pdf-actions";
import {
  INCIDENT_CATEGORY_OPTIONS,
  INCIDENT_INJURY_TYPE_OPTIONS,
  INCIDENT_LOCATION_OPTIONS,
  type IncidentDetail,
  type IncidentEditorLookups
} from "@/lib/services/incident-shared";
import { toEasternDateTimeLocal } from "@/lib/timezone";
import { formatDateTime, formatOptionalDateTime } from "@/lib/utils";

type IncidentFormProps = {
  detail: IncidentDetail | null;
  lookups: IncidentEditorLookups;
  actorId: string;
  actorName: string;
  canReview: boolean;
  canAmend: boolean;
  canEditInitial: boolean;
};

type TabKey = "details" | "people" | "notes" | "review";

const TAB_ITEMS: Array<{ key: TabKey; label: string }> = [
  { key: "details", label: "Incident Details" },
  { key: "people", label: "People & Injury" },
  { key: "notes", label: "Notes & Follow-up" },
  { key: "review", label: "Review & Audit" }
];

function statusClasses(status: string) {
  switch (status) {
    case "submitted":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "returned":
      return "border-rose-200 bg-rose-50 text-rose-800";
    case "approved":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "closed":
      return "border-slate-300 bg-slate-100 text-slate-700";
    case "draft":
    default:
      return "border-sky-200 bg-sky-50 text-sky-800";
  }
}

function defaultDateTime(value: string | null | undefined) {
  return toEasternDateTimeLocal(value ?? new Date());
}

export function IncidentForm(props: IncidentFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const reviewFormRef = useRef<HTMLFormElement | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("details");
  const { isSaving: isPending, run: runEditorMutation } = useScopedMutation();
  const { isSaving: isReviewPending, run: runReviewMutation } = useScopedMutation();
  const [statusMessage, setStatusMessage] = useState("");
  const [currentDetail, setCurrentDetail] = useState<IncidentDetail | null>(props.detail);
  const [unsafeConditionsPresent, setUnsafeConditionsPresent] = useState(props.detail?.unsafeConditionsPresent ?? false);
  const [editorEnabled, setEditorEnabled] = useState(props.canEditInitial);

  useEffect(() => {
    setCurrentDetail(props.detail);
    setUnsafeConditionsPresent(props.detail?.unsafeConditionsPresent ?? false);
  }, [props.detail]);

  const detail = currentDetail;
  const status = detail?.status ?? "draft";
  const canSubmit = editorEnabled;
  const showAmendmentControls = props.canAmend && (status === "approved" || status === "closed");
  const submitterSignatureValue = detail?.submitterSignatureName ?? "";
  const submitterSignedLabel = detail?.submitterSignedAt ? formatDateTime(detail.submitterSignedAt) : null;

  function handleEditorResult(result: Awaited<ReturnType<typeof saveIncidentDraftAction>>, successMessage: string) {
    if (!result.ok) {
      setStatusMessage(`Error: ${result.error}`);
      return;
    }
    setStatusMessage(successMessage);
    if (result.detail) {
      setCurrentDetail(result.detail);
      setUnsafeConditionsPresent(result.detail.unsafeConditionsPresent);
    }
    if (!detail || detail.id !== result.incidentId) {
      router.replace(`/documentation/incidents/${result.incidentId}`);
    }
  }

  function runEditorAction(mode: "draft" | "submit" | "amend") {
    if (!formRef.current) return;
    const formData = new FormData(formRef.current);
    setStatusMessage("");
    void runEditorMutation(
      async () =>
        mode === "submit"
          ? submitIncidentAction(formData)
          : mode === "amend"
            ? amendIncidentAction(formData)
            : saveIncidentDraftAction(formData),
      {
        successMessage: mode === "submit" ? "Incident submitted for director review." : mode === "amend" ? "Incident amended." : "Draft saved.",
        fallbackData: { incidentId: detail?.id ?? undefined, status: detail?.status ?? "draft", detail: detail ?? undefined },
        onSuccess: async (result) => {
          if (!result.data.incidentId || !result.data.detail) {
            setStatusMessage("Error: Incident saved but the updated record was not returned.");
            return;
          }
          handleEditorResult(
            { ok: true, incidentId: result.data.incidentId, status: result.data.status, detail: result.data.detail },
            result.message
          );
          if (mode === "amend") {
            setEditorEnabled(false);
          }
        },
        onError: async (result) => {
          setStatusMessage(`Error: ${result.error}`);
        }
      }
    );
  }

  function runReviewAction(decision: "approved" | "returned" | "closed") {
    if (!detail?.id || !reviewFormRef.current) return;
    const formData = new FormData(reviewFormRef.current);
    formData.set("incidentId", detail.id);
    setStatusMessage("");
    void runReviewMutation(
      async () => (decision === "closed" ? closeIncidentAction(formData) : reviewIncidentAction(formData)),
      {
        successMessage:
          decision === "approved" ? "Incident approved." : decision === "returned" ? "Incident returned for correction." : "Incident closed.",
        fallbackData: { incidentId: detail.id, status: detail.status, detail },
        onSuccess: async (result) => {
          if (result.data.detail) {
            setCurrentDetail(result.data.detail);
            setUnsafeConditionsPresent(result.data.detail.unsafeConditionsPresent);
          }
          setStatusMessage(result.message);
        },
        onError: async (result) => {
          setStatusMessage(`Error: ${result.error}`);
        }
      }
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        {detail?.status === "returned" && detail.directorReviewNotes ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
            <p className="font-semibold">Returned by director</p>
            <p className="mt-1">{detail.directorReviewNotes}</p>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {TAB_ITEMS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                activeTab === tab.key ? "border-brand bg-brand text-white" : "border-border bg-white text-primary-text"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <form ref={formRef} className="space-y-4 rounded-2xl border border-border bg-white p-4 shadow-sm">
          <input type="hidden" name="incidentId" value={detail?.id ?? ""} />

          {showAmendmentControls ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-amber-900">Approved records are locked</p>
                  <p className="text-xs text-amber-800">Admins can enable amendment mode when a state-facing correction is required.</p>
                </div>
                <button
                  type="button"
                  className="rounded-lg border border-amber-300 px-3 py-2 text-sm font-semibold text-amber-900"
                  onClick={() => setEditorEnabled((current) => !current)}
                >
                  {editorEnabled ? "Cancel Amendment" : "Enable Amendment"}
                </button>
              </div>
              {editorEnabled ? (
                <div className="mt-3">
                  <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="amendmentNote">
                    Amendment Note
                  </label>
                  <textarea
                    id="amendmentNote"
                    name="amendmentNote"
                    rows={3}
                    className="w-full rounded-lg border border-border p-3 text-sm"
                    placeholder="Explain exactly why this approved report is being amended."
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {activeTab === "details" ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Incident Category</label>
                <select
                  name="incidentCategory"
                  defaultValue={detail?.incidentCategory ?? "fall"}
                  disabled={!editorEnabled}
                  className="h-11 w-full rounded-lg border border-border px-3 text-sm"
                >
                  {INCIDENT_CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Reportable</label>
                <div className="flex gap-2">
                  <label className="flex flex-1 items-center gap-2 rounded-lg border border-border px-3 py-3 text-sm">
                    <input type="radio" name="reportable" value="true" defaultChecked={detail?.reportable === true} disabled={!editorEnabled} />
                    Yes
                  </label>
                  <label className="flex flex-1 items-center gap-2 rounded-lg border border-border px-3 py-3 text-sm">
                    <input type="radio" name="reportable" value="false" defaultChecked={!detail || detail.reportable === false} disabled={!editorEnabled} />
                    No
                  </label>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Incident Date / Time</label>
                <input
                  name="incidentDateTime"
                  type="datetime-local"
                  defaultValue={defaultDateTime(detail?.incidentDateTime)}
                  disabled={!editorEnabled}
                  className="h-11 w-full rounded-lg border border-border px-3 text-sm"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Reported Date / Time</label>
                <input
                  name="reportedDateTime"
                  type="datetime-local"
                  defaultValue={defaultDateTime(detail?.reportedDateTime)}
                  disabled={!editorEnabled}
                  className="h-11 w-full rounded-lg border border-border px-3 text-sm"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Location</label>
                <select
                  name="location"
                  defaultValue={detail?.location ?? "Activity Floor"}
                  disabled={!editorEnabled}
                  className="h-11 w-full rounded-lg border border-border px-3 text-sm"
                >
                  {INCIDENT_LOCATION_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Exact Location Details</label>
                <input
                  name="exactLocationDetails"
                  defaultValue={detail?.exactLocationDetails ?? ""}
                  disabled={!editorEnabled}
                  className="h-11 w-full rounded-lg border border-border px-3 text-sm"
                  placeholder="Table 3, near front desk, van step, etc."
                />
              </div>

              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-muted">Description Including Cause</label>
                <textarea
                  name="description"
                  rows={7}
                  defaultValue={detail?.description ?? ""}
                  disabled={!editorEnabled}
                  className="w-full rounded-lg border border-border p-3 text-sm"
                  placeholder="Briefly document what happened, what led up to it, and what staff observed."
                />
              </div>
            </div>
          ) : null}

          {activeTab === "people" ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Participant Involved</label>
                <select
                  name="participantId"
                  defaultValue={detail?.participantId ?? ""}
                  disabled={!editorEnabled}
                  className="h-11 w-full rounded-lg border border-border px-3 text-sm"
                >
                  <option value="">Not applicable</option>
                  {props.lookups.participants.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Staff Member Involved</label>
                <select
                  name="staffMemberId"
                  defaultValue={detail?.staffMemberId ?? ""}
                  disabled={!editorEnabled}
                  className="h-11 w-full rounded-lg border border-border px-3 text-sm"
                >
                  <option value="">Not applicable</option>
                  {props.lookups.staffMembers.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="mb-1 block text-xs font-semibold text-muted">Additional Parties Involved</label>
                <input
                  name="additionalParties"
                  defaultValue={detail?.additionalParties ?? ""}
                  disabled={!editorEnabled}
                  className="h-11 w-full rounded-lg border border-border px-3 text-sm"
                  placeholder="Witnesses, family, transportation partner, outside responder, etc."
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Unsafe Conditions Present</label>
                <div className="flex gap-2">
                  <label className="flex flex-1 items-center gap-2 rounded-lg border border-border px-3 py-3 text-sm">
                    <input
                      type="radio"
                      name="unsafeConditionsPresent"
                      value="true"
                      defaultChecked={detail?.unsafeConditionsPresent === true}
                      disabled={!editorEnabled}
                      onChange={() => setUnsafeConditionsPresent(true)}
                    />
                    Yes
                  </label>
                  <label className="flex flex-1 items-center gap-2 rounded-lg border border-border px-3 py-3 text-sm">
                    <input
                      type="radio"
                      name="unsafeConditionsPresent"
                      value="false"
                      defaultChecked={!detail || detail.unsafeConditionsPresent === false}
                      disabled={!editorEnabled}
                      onChange={() => setUnsafeConditionsPresent(false)}
                    />
                    No
                  </label>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Injured By</label>
                <input
                  name="injuredBy"
                  defaultValue={detail?.injuredBy ?? ""}
                  disabled={!editorEnabled}
                  className="h-11 w-full rounded-lg border border-border px-3 text-sm"
                  placeholder="Floor, another participant, object, self, unknown"
                />
              </div>

              {unsafeConditionsPresent ? (
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-semibold text-muted">Unsafe Conditions Description</label>
                  <textarea
                    name="unsafeConditionsDescription"
                    rows={4}
                    defaultValue={detail?.unsafeConditionsDescription ?? ""}
                    disabled={!editorEnabled}
                    className="w-full rounded-lg border border-border p-3 text-sm"
                  />
                </div>
              ) : (
                <input type="hidden" name="unsafeConditionsDescription" value={detail?.unsafeConditionsDescription ?? ""} />
              )}

              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Injury Type</label>
                <select
                  name="injuryType"
                  defaultValue={detail?.injuryType ?? "None"}
                  disabled={!editorEnabled}
                  className="h-11 w-full rounded-lg border border-border px-3 text-sm"
                >
                  {INCIDENT_INJURY_TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Body Part</label>
                <input
                  name="bodyPart"
                  defaultValue={detail?.bodyPart ?? ""}
                  disabled={!editorEnabled}
                  className="h-11 w-full rounded-lg border border-border px-3 text-sm"
                  placeholder="Head, arm, knee, hip, etc."
                />
              </div>
            </div>
          ) : null}

          {activeTab === "notes" ? (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">General Notes</label>
                <textarea
                  name="generalNotes"
                  rows={6}
                  defaultValue={detail?.generalNotes ?? ""}
                  disabled={!editorEnabled}
                  className="w-full rounded-lg border border-border p-3 text-sm"
                  placeholder="Immediate response, who was present, and any extra operational detail."
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-muted">Follow-up Note</label>
                <textarea
                  name="followUpNote"
                  rows={6}
                  defaultValue={detail?.followUpNote ?? ""}
                  disabled={!editorEnabled}
                  className="w-full rounded-lg border border-border p-3 text-sm"
                  placeholder="What needs to happen next, or what the team should monitor."
                />
              </div>

              <div className="rounded-xl border border-brand/20 bg-brandSoft/40 p-4">
                <label className="mb-1 block text-xs font-semibold text-muted" htmlFor="submitterSignatureName">
                  Submitter E-Sign
                </label>
                {editorEnabled ? (
                  <>
                    <input
                      id="submitterSignatureName"
                      name="submitterSignatureName"
                      defaultValue={submitterSignatureValue}
                      className="h-11 w-full rounded-lg border border-border px-3 text-sm"
                      placeholder={props.actorName}
                      autoComplete="name"
                    />
                    <p className="mt-2 text-xs text-muted">
                      Type your full name exactly as it appears on your account to submit this incident.
                    </p>
                  </>
                ) : (
                  <div className="rounded-lg border border-border bg-white px-3 py-3 text-sm">
                    <p className="font-medium">{submitterSignatureValue || "Not signed yet"}</p>
                    <p className="mt-1 text-xs text-muted">
                      {submitterSignedLabel ? `Signed on ${submitterSignedLabel}` : "A submitter e-sign is required at submission."}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {activeTab === "review" ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-border bg-slate-50 p-4">
                <p className="text-sm font-semibold">Record Audit Trail</p>
                <p className="mt-1 text-xs text-muted">
                  Entered by {detail?.reporterName ?? props.actorName} on {formatOptionalDateTime(detail?.createdAt ?? new Date())}
                </p>
                {detail?.submittedAt ? (
                  <p className="mt-1 text-xs text-muted">
                    Submitted by {detail.submittedByName ?? detail.reporterName} on {formatDateTime(detail.submittedAt)}
                  </p>
                ) : null}
                {detail?.submitterSignatureName ? (
                  <p className="mt-1 text-xs text-muted">
                    Submitter e-sign: {detail.submitterSignatureName}
                    {detail.submitterSignedAt ? ` on ${formatDateTime(detail.submitterSignedAt)}` : ""}
                  </p>
                ) : null}
                {detail?.directorReviewedAt ? (
                  <p className="mt-1 text-xs text-muted">
                    Director review by {detail.directorSignatureName ?? "-"} on {formatDateTime(detail.directorReviewedAt)}
                  </p>
                ) : null}
              </div>

              {detail ? (
                <div className="space-y-2">
                  {detail.history.map((item) => (
                    <div key={item.id} className="rounded-xl border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold capitalize">{item.action.replaceAll("_", " ")}</p>
                        <p className="text-xs text-muted">{formatDateTime(item.createdAt)}</p>
                      </div>
                      <p className="mt-1 text-xs text-muted">{item.userName ?? "System"}</p>
                      {item.notes ? <p className="mt-2 text-sm">{item.notes}</p> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted">History will appear after the first save.</p>
              )}
            </div>
          ) : null}
        </form>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => runEditorAction(showAmendmentControls && editorEnabled ? "amend" : "draft")}
            disabled={isPending || !editorEnabled}
            className="rounded-lg border border-border px-4 py-2 text-sm font-semibold disabled:opacity-60"
          >
            {isPending ? "Saving..." : showAmendmentControls && editorEnabled ? "Save Amendment" : "Save Draft"}
          </button>
          <button
            type="button"
            onClick={() => runEditorAction("submit")}
            disabled={isPending || !canSubmit || showAmendmentControls}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {isPending ? "Working..." : "Submit Incident"}
          </button>
          <MutationNotice kind={statusMessage.startsWith("Error") ? "error" : "success"} message={statusMessage || null} className="self-center" />
        </div>

        {detail && props.canReview ? (
          <form ref={reviewFormRef} className="rounded-2xl border border-border bg-white p-4 shadow-sm">
            <input type="hidden" name="incidentId" value={detail.id} />
            <input type="hidden" name="decision" value="approved" />
            <p className="text-base font-semibold">Director Review</p>
            <p className="mt-1 text-sm text-muted">
              Approve to lock the report, or return it with correction notes for the reporter.
            </p>
            <div className="mt-3">
              <label className="mb-1 block text-xs font-semibold text-muted">Review Notes</label>
              <textarea
                name="reviewNotes"
                defaultValue={detail.directorReviewNotes ?? ""}
                rows={4}
                className="w-full rounded-lg border border-border p-3 text-sm"
                placeholder="Director comments, corrections requested, or approval note."
              />
            </div>
            {detail.status === "submitted" ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  disabled={isReviewPending}
                  onClick={() => {
                    if (reviewFormRef.current) {
                      const decisionInput = reviewFormRef.current.querySelector<HTMLInputElement>('input[name="decision"]');
                      if (decisionInput) decisionInput.value = "approved";
                    }
                    runReviewAction("approved");
                  }}
                >
                  {isReviewPending ? "Saving..." : "Approve"}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-800 disabled:opacity-60"
                  disabled={isReviewPending}
                  onClick={() => {
                    if (reviewFormRef.current) {
                      const decisionInput = reviewFormRef.current.querySelector<HTMLInputElement>('input[name="decision"]');
                      if (decisionInput) decisionInput.value = "returned";
                    }
                    runReviewAction("returned");
                  }}
                >
                  Return for Correction
                </button>
              </div>
            ) : null}
            {detail.status === "approved" ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-border px-4 py-2 text-sm font-semibold disabled:opacity-60"
                  disabled={isReviewPending}
                  onClick={() => runReviewAction("closed")}
                >
                  {isReviewPending ? "Saving..." : "Close Record"}
                </button>
              </div>
            ) : null}
          </form>
        ) : null}
      </div>

      <aside className="space-y-4">
        <div className="rounded-2xl border border-border bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">Status Panel</p>
          <div className="mt-3 space-y-3">
            <div>
              <p className="text-xs text-muted">Incident Number</p>
              <p className="text-base font-semibold">{detail?.incidentNumber ?? "New Draft"}</p>
            </div>
            <div className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold capitalize ${statusClasses(status)}`}>
              {status.replaceAll("_", " ")}
            </div>
            <div className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-semibold">
              {detail?.reportable ? "Reportable" : "Non-reportable"}
            </div>
            <div>
              <p className="text-xs text-muted">Entered By</p>
              <p className="text-sm font-medium">{detail?.reporterName ?? props.actorName}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Submitted</p>
              <p className="text-sm">{formatOptionalDateTime(detail?.submittedAt, "Not submitted yet")}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Submitter E-Sign</p>
              <p className="text-sm">{detail?.submitterSignatureName ?? "Pending signature"}</p>
              <p className="text-xs text-muted">{formatOptionalDateTime(detail?.submitterSignedAt, "Not signed yet")}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Director</p>
              <p className="text-sm">{detail?.directorSignatureName ?? "Pending review"}</p>
            </div>
            {detail ? <IncidentPdfActions incidentId={detail.id} /> : null}
          </div>
        </div>
      </aside>
    </div>
  );
}
