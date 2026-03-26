"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import {
  runDocumentationCreateAction
} from "@/app/documentation-create-actions";
import { Button } from "@/components/ui/button";
import { easternDateTimeLocalToISO, toEasternDate, toEasternDateTimeLocal } from "@/lib/timezone";
import {
  TOILET_USE_TYPE_OPTIONS,
  TRANSPORT_TYPE_OPTIONS
} from "@/lib/canonical";

const TOILET_OPTIONS = TOILET_USE_TYPE_OPTIONS;
const TRANSPORT_OPTIONS = TRANSPORT_TYPE_OPTIONS;
const MAX_PHOTO_UPLOAD_BYTES = 5 * 1024 * 1024;

type MemberOption = {
  id: string;
  display_name: string;
};

function useNowIso() {
  return useMemo(() => toEasternDateTimeLocal(), []);
}

function useToday() {
  return useMemo(() => toEasternDate(), []);
}

export function ToiletLogForm({ members }: { members: MemberOption[] }) {
  const now = useNowIso();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [form, setForm] = useState({
    memberId: members[0]?.id ?? "",
    eventAt: now,
    briefs: false,
    memberSupplied: true,
    useType: TOILET_OPTIONS[0] as (typeof TOILET_OPTIONS)[number],
    notes: ""
  });

  const willGenerateCharge = form.briefs && !form.memberSupplied;
  const saveToiletTooltip = willGenerateCharge
    ? "Saves toilet log and auto-generates a Briefs ancillary charge."
    : "Saves toilet log without auto-generating a Briefs ancillary charge.";

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <select className="h-11 rounded-lg border border-border px-3" value={form.memberId} onChange={(e) => setForm((f) => ({ ...f, memberId: e.target.value }))}>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.display_name}</option>
          ))}
        </select>
        <input type="datetime-local" className="h-11 rounded-lg border border-border px-3" value={form.eventAt} onChange={(e) => setForm((f) => ({ ...f, eventAt: e.target.value }))} />
        <select
          className="h-11 rounded-lg border border-border px-3"
          value={form.useType}
          onChange={(e) => setForm((f) => ({ ...f, useType: e.target.value as (typeof TOILET_OPTIONS)[number] }))}
        >
          {TOILET_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.briefs} onChange={(e) => setForm((f) => ({ ...f, briefs: e.target.checked }))} />
          Briefs Changed
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.memberSupplied} onChange={(e) => setForm((f) => ({ ...f, memberSupplied: e.target.checked }))} />
          Member Supplied
        </label>
      </div>

      <textarea className="min-h-20 w-full rounded-lg border border-border p-3 text-sm" placeholder="Additional notes (optional)" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />

      <Button type="button" title={saveToiletTooltip} disabled={isPending || !form.memberId} onClick={() => startTransition(async () => {
        const res = await runDocumentationCreateAction({
          kind: "createToiletLog",
          payload: {
            memberId: form.memberId,
            eventAt: easternDateTimeLocalToISO(form.eventAt),
            briefs: form.briefs,
            memberSupplied: form.memberSupplied,
            useType: form.useType,
            notes: form.notes
          }
        });
        setStatus(res.error ? `Error: ${res.error}` : "Toilet log saved.");
      })}>Save Toilet Log</Button>
      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}

export function ShowerLogForm({ members }: { members: MemberOption[] }) {
  const now = useNowIso();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [form, setForm] = useState({ memberId: members[0]?.id ?? "", eventAt: now, laundry: false, briefs: false, notes: "" });

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <select className="h-11 rounded-lg border border-border px-3" value={form.memberId} onChange={(e) => setForm((f) => ({ ...f, memberId: e.target.value }))}>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.display_name}</option>
          ))}
        </select>
        <input type="datetime-local" className="h-11 rounded-lg border border-border px-3" value={form.eventAt} onChange={(e) => setForm((f) => ({ ...f, eventAt: e.target.value }))} />
      </div>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.laundry} onChange={(e) => setForm((f) => ({ ...f, laundry: e.target.checked }))} /> Laundry</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.briefs} onChange={(e) => setForm((f) => ({ ...f, briefs: e.target.checked }))} /> Briefs changed</label>
      </div>
      <textarea className="min-h-20 w-full rounded-lg border border-border p-3 text-sm" placeholder="Notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
      <Button type="button" disabled={isPending || !form.memberId} onClick={() => startTransition(async () => {
        const res = await runDocumentationCreateAction({
          kind: "createShowerLog",
          payload: {
            memberId: form.memberId,
            eventAt: easternDateTimeLocalToISO(form.eventAt),
            laundry: form.laundry,
            briefs: form.briefs,
            notes: form.notes
          }
        });
        setStatus(res.error ? `Error: ${res.error}` : "Shower log saved.");
      })}>Save Shower Log</Button>
      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}

export function TransportationLogForm({ members }: { members: MemberOption[] }) {
  const today = useToday();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [form, setForm] = useState({ memberId: members[0]?.id ?? "", period: "AM" as "AM" | "PM", transportType: "Door to door" as (typeof TRANSPORT_OPTIONS)[number], serviceDate: today });

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-4">
        <select className="h-11 rounded-lg border border-border px-3" value={form.memberId} onChange={(e) => setForm((f) => ({ ...f, memberId: e.target.value }))}>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.display_name}</option>
          ))}
        </select>

        <select className="h-11 rounded-lg border border-border px-3" value={form.period} onChange={(e) => setForm((f) => ({ ...f, period: e.target.value as "AM" | "PM" }))}>
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>

        <select className="h-11 rounded-lg border border-border px-3" value={form.transportType} onChange={(e) => setForm((f) => ({ ...f, transportType: e.target.value as (typeof TRANSPORT_OPTIONS)[number] }))}>
          {TRANSPORT_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>

        <input type="date" className="h-11 rounded-lg border border-border px-3" value={form.serviceDate} onChange={(e) => setForm((f) => ({ ...f, serviceDate: e.target.value }))} />
      </div>

      <p className="text-xs text-muted">Notes are intentionally disabled to match AppSheet transportation flow.</p>

      <Button type="button" disabled={isPending || !form.memberId} onClick={() => startTransition(async () => {
        const res = await runDocumentationCreateAction({
          kind: "createTransportationLog",
          payload: form
        });
        setStatus(res.error ? `Error: ${res.error}` : "Transportation log saved.");
      })}>Save Transportation Log</Button>
      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}

export function PhotoUploadForm() {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  useEffect(() => {
    return () => {
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [previewUrls]);

  const onFilesSelect = (selectedList: FileList | null) => {
    previewUrls.forEach((url) => URL.revokeObjectURL(url));

    const selectedFiles = Array.from(selectedList ?? []);
    const validFiles = selectedFiles.filter((file) => file.size <= MAX_PHOTO_UPLOAD_BYTES);
    const oversizedFiles = selectedFiles.filter((file) => file.size > MAX_PHOTO_UPLOAD_BYTES);

    setFiles(validFiles);
    if (oversizedFiles.length > 0) {
      setStatus(
        `Skipped ${oversizedFiles.length} file(s) over 5MB. Max allowed per photo is 5MB.`
      );
    } else {
      setStatus(null);
    }

    const urls = validFiles.map((file) => URL.createObjectURL(file));
    setPreviewUrls(urls);
  };

  const fileToDataUrl = async (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
          return;
        }
        reject(new Error("Could not read file."));
      };
      reader.onerror = () => reject(new Error("Could not read file."));
      reader.readAsDataURL(file);
    });

  return (
    <div className="space-y-3">
      <div className="grid gap-3">
        <input
          type="file"
          multiple
          accept="image/*"
          className="h-11 rounded-lg border border-border bg-white px-3 py-2 text-fg"
          onChange={(e) => onFilesSelect(e.target.files)}
        />
      </div>

      {files.length > 0 ? (
        <div className="rounded-lg border border-border p-2">
          <p className="mb-2 text-xs font-semibold text-muted">Selected Files ({files.length})</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {files.map((file, index) => (
              <div key={`${file.name}-${file.size}-${index}`} className="rounded border border-border p-2">
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewUrls[index]} alt={file.name} className="max-h-36 w-full rounded object-cover" />
                </>
                <p className="mt-2 truncate text-xs font-semibold">{file.name}</p>
                <p className="text-xs text-muted">{file.type || "image/*"}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <Button
        type="button"
        disabled={isPending || files.length === 0}
        onClick={() =>
          startTransition(async () => {
            let saved = 0;
            const failures: string[] = [];

            for (const file of files) {
              try {
                if (file.size > MAX_PHOTO_UPLOAD_BYTES) {
                  failures.push(`${file.name}: exceeds 5MB limit.`);
                  continue;
                }
                const fileDataUrl = await fileToDataUrl(file);
                const res = await runDocumentationCreateAction({
                  kind: "createPhotoUpload",
                  payload: {
                    fileName: file.name,
                    fileType: file.type || "image/*",
                    fileDataUrl
                  }
                });

                if (res.error) {
                  failures.push(`${file.name}: ${res.error}`);
                } else {
                  saved += 1;
                }
              } catch {
                failures.push(`${file.name}: Unable to process file.`);
              }
            }

            if (saved > 0 && failures.length === 0) {
              setStatus(`Saved ${saved} photo upload${saved === 1 ? "" : "s"}.`);
            } else if (saved > 0 && failures.length > 0) {
              setStatus(`Saved ${saved} file(s). ${failures.length} failed.`);
            } else {
              setStatus(`Error: ${failures[0] ?? "No files were saved."}`);
            }

            if (saved > 0) {
              previewUrls.forEach((url) => URL.revokeObjectURL(url));
              setFiles([]);
              setPreviewUrls([]);
            }
          })
        }
      >
        Save Photo Uploads
      </Button>

      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}

export function BloodSugarForm({ compact = false, members }: { members: MemberOption[]; compact?: boolean }) {
  const now = useNowIso();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [form, setForm] = useState({ memberId: members[0]?.id ?? "", checkedAt: now, readingMgDl: 110, notes: "" });

  return (
    <div className="space-y-3">
      <div className={`grid gap-3 ${compact ? "xl:grid-cols-[minmax(0,1.6fr)_190px_160px]" : "md:grid-cols-3"}`}>
        <select className="h-11 rounded-lg border border-border px-3" value={form.memberId} onChange={(e) => setForm((f) => ({ ...f, memberId: e.target.value }))}>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.display_name}</option>
          ))}
        </select>
        <input type="datetime-local" className="h-11 rounded-lg border border-border px-3" value={form.checkedAt} onChange={(e) => setForm((f) => ({ ...f, checkedAt: e.target.value }))} />
        <input type="number" className="h-11 rounded-lg border border-border px-3" value={form.readingMgDl} onChange={(e) => setForm((f) => ({ ...f, readingMgDl: Number(e.target.value) }))} />
      </div>
      <div className={`grid gap-3 ${compact ? "xl:grid-cols-[minmax(0,1fr)_160px]" : ""}`}>
        <textarea
          className={`w-full rounded-lg border border-border p-3 text-sm ${compact ? "min-h-16" : "min-h-20"}`}
          placeholder={compact ? "Brief note (optional)" : "Notes"}
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
        />
        <Button type="button" disabled={isPending || !form.memberId} onClick={() => startTransition(async () => {
          const res = await runDocumentationCreateAction({
            kind: "createBloodSugarLog",
            payload: { ...form, checkedAt: easternDateTimeLocalToISO(form.checkedAt) }
          });
          setStatus(res.error ? `Error: ${res.error}` : "Blood sugar log saved.");
        })}>Save Blood Sugar</Button>
      </div>
      {status ? <p className="text-sm text-muted">{status}</p> : null}
    </div>
  );
}
