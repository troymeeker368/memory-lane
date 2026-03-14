"use client";

import { useMemo, useState, useTransition } from "react";

import { generateMemberNameBadgePdfAction } from "@/app/(portal)/members/[memberId]/name-badge/actions";

interface BadgeIndicatorView {
  key: string;
  label: string;
  shortLabel: string;
  enabled: boolean;
  iconSrc: string | null;
}

interface BadgeViewModel {
  generatedAt: string;
  member: {
    id: string;
    preferredName: string | null;
    firstName: string | null;
    lastName: string | null;
    fullName: string | null;
    name: string | null;
    displayName: string | null;
    displayNameSource: string;
    lockerNumber: string | null;
  };
  logoSrc: string;
  indicators: BadgeIndicatorView[];
}

function dataUrlToBlob(dataUrl: string) {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) {
    throw new Error("Invalid PDF payload.");
  }
  const meta = dataUrl.slice(0, commaIndex);
  const base64 = dataUrl.slice(commaIndex + 1);
  const mimeMatch = /data:([^;]+);base64/i.exec(meta);
  const mimeType = mimeMatch?.[1] ?? "application/octet-stream";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

async function triggerDownload(dataUrl: string, fileName: string) {
  const blob = dataUrlToBlob(dataUrl);
  if ("showSaveFilePicker" in window) {
    try {
      const handle = await (window as Window & {
        showSaveFilePicker?: (options?: {
          suggestedName?: string;
          types?: Array<{ description: string; accept: Record<string, string[]> }>;
        }) => Promise<{
          createWritable: () => Promise<{
            write: (data: Blob) => Promise<void>;
            close: () => Promise<void>;
          }>;
        }>;
      }).showSaveFilePicker?.({
        suggestedName: fileName,
        types: [{ description: "PDF Document", accept: { "application/pdf": [".pdf"] } }]
      });
      if (handle) {
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      }
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      if (name === "AbortError") return;
    }
  }

  const blobUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

export function NameBadgeBuilder({
  memberId,
  badge
}: {
  memberId: string;
  badge: BadgeViewModel;
}) {
  const [selectedKeys, setSelectedKeys] = useState<string[]>(
    badge.indicators.filter((indicator) => indicator.enabled).map((indicator) => indicator.key)
  );
  const [status, setStatus] = useState("");
  const [isPending, startTransition] = useTransition();

  const selectedIndicators = useMemo(
    () => badge.indicators.filter((indicator) => selectedKeys.includes(indicator.key)),
    [badge.indicators, selectedKeys]
  );
  const memberDisplayName = useMemo(() => (badge.member.displayName ?? "").trim(), [badge.member.displayName]);
  const hasResolvedName = memberDisplayName.length > 0;
  const nameResolutionError =
    "Unable to render badge: this member does not have a usable name. Add a preferred/first/last name or full display name, then try again.";
  const nameFontSizePx = useMemo(() => {
    const text = memberDisplayName;
    const length = text.length || 1;
    // Approximate Helvetica Bold width factor for uppercase/mixed names.
    const estimatedWidthFactor = 0.58;
    const availableWidthPx = 320;
    const fitSize = availableWidthPx / (length * estimatedWidthFactor);
    return Math.max(18, Math.min(24, fitSize));
  }, [memberDisplayName]);

  function toggleIndicator(key: string) {
    setSelectedKeys((current) => (current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]));
  }

  function resetToDefaults() {
    setSelectedKeys(badge.indicators.filter((indicator) => indicator.enabled).map((indicator) => indicator.key));
  }

  function runGeneration(printAfterDownload: boolean) {
    if (!hasResolvedName) {
      setStatus(`Error: ${nameResolutionError}`);
      return;
    }
    setStatus("");
    startTransition(async () => {
      const result = await generateMemberNameBadgePdfAction({
        memberId,
        selectedIndicatorKeys: selectedKeys
      });
      if (!result?.ok) {
        setStatus(`Error: ${result?.error ?? "Unable to generate badge."}`);
        return;
      }
      await triggerDownload(result.dataUrl, result.fileName);
      if (printAfterDownload) {
        window.print();
      }
      setStatus("Name badge saved to Files/Documents and downloaded.");
    });
  }

  return (
    <div className="space-y-4">
      <div className="print-hide rounded-lg border border-border p-3">
        <p className="text-sm font-semibold">Badge Indicators</p>
        <p className="text-xs text-muted">
          Auto-populated from MCC/MHP. Toggle any additional indicators before generating.
        </p>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {badge.indicators.map((indicator) => (
            <label key={indicator.key} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={selectedKeys.includes(indicator.key)}
                onChange={() => toggleIndicator(indicator.key)}
              />
              {indicator.iconSrc ? (
                <img src={indicator.iconSrc} alt={indicator.label} className="h-6 w-6 object-contain" />
              ) : (
                <span className="inline-flex h-6 w-6 items-center justify-center rounded border border-brand text-xs font-semibold text-brand">
                  {indicator.shortLabel}
                </span>
              )}
              <span>{indicator.label}</span>
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white disabled:opacity-70"
            onClick={() => runGeneration(false)}
            disabled={isPending || !hasResolvedName}
          >
            {isPending ? "Generating..." : "Download PDF"}
          </button>
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold disabled:opacity-70"
            onClick={() => runGeneration(true)}
            disabled={isPending || !hasResolvedName}
          >
            Print
          </button>
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold"
            onClick={resetToDefaults}
            disabled={isPending}
          >
            Reset from Profile
          </button>
        </div>
        {!hasResolvedName ? <p className="mt-2 text-xs text-[#B42318]">{nameResolutionError}</p> : null}
        {status ? <p className={`mt-2 text-xs ${status.startsWith("Error:") ? "text-[#B42318]" : "text-muted"}`}>{status}</p> : null}
      </div>

      {hasResolvedName ? (
        <div className="name-badge-preview">
          <div className="name-badge-star name-badge-star-left">*</div>
          <div className="name-badge-star name-badge-star-right">*</div>
          <img src={badge.logoSrc} alt="Town Square Fort Mill logo" className="name-badge-logo" />
          <p className="name-badge-member-name" style={{ fontSize: `${nameFontSizePx}px` }}>
            {memberDisplayName}
          </p>
          <p className="name-badge-locker">{badge.member.lockerNumber ? `LOCKER ${badge.member.lockerNumber}` : "LOCKER ##"}</p>
          <div className="name-badge-divider" />
          <div className="name-badge-icons">
            {selectedIndicators.length === 0 ? (
              <p className="name-badge-empty-icons">No indicators selected</p>
            ) : (
              selectedIndicators.map((indicator) =>
                indicator.iconSrc ? (
                  <div key={indicator.key} className="name-badge-icon-item" title={indicator.label}>
                    <img src={indicator.iconSrc} alt={indicator.label} className="name-badge-icon" />
                  </div>
                ) : (
                  <div key={indicator.key} className="name-badge-icon-fallback" title={indicator.label}>
                    <span aria-hidden>*</span>
                  </div>
                )
              )
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-[#f0b6b6] bg-[#fff6f6] px-4 py-3 text-sm text-[#7f1d1d]">
          {nameResolutionError}
        </div>
      )}
    </div>
  );
}

