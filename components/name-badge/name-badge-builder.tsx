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
    name: string;
    initials: string;
    lockerNumber: string | null;
  };
  logoSrc: string;
  indicators: BadgeIndicatorView[];
}

function triggerDownload(dataUrl: string, fileName: string) {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
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
  const memberDisplayName = useMemo(() => {
    const normalized = badge.member.name.trim();
    if (normalized.length > 0) return normalized;
    const initials = badge.member.initials.trim();
    if (initials.length > 0) return initials;
    return "Member Name";
  }, [badge.member.initials, badge.member.name]);
  const nameFontSizeMm = useMemo(() => {
    const text = memberDisplayName;
    const length = text.length || 1;
    // Approximate Helvetica Bold width factor for uppercase/mixed names.
    const estimatedWidthFactor = 0.58;
    const availableWidthMm = 84;
    const fitSize = availableWidthMm / (length * estimatedWidthFactor);
    return Math.max(3.8, Math.min(7.8, fitSize));
  }, [memberDisplayName]);

  function toggleIndicator(key: string) {
    setSelectedKeys((current) => (current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]));
  }

  function resetToDefaults() {
    setSelectedKeys(badge.indicators.filter((indicator) => indicator.enabled).map((indicator) => indicator.key));
  }

  function runGeneration(printAfterDownload: boolean) {
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
      triggerDownload(result.dataUrl, result.fileName);
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
            disabled={isPending}
          >
            {isPending ? "Generating..." : "Download PDF"}
          </button>
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold disabled:opacity-70"
            onClick={() => runGeneration(true)}
            disabled={isPending}
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
        {status ? <p className="mt-2 text-xs text-muted">{status}</p> : null}
      </div>

      <div className="name-badge-preview">
        <div className="name-badge-star name-badge-star-left">*</div>
        <div className="name-badge-star name-badge-star-right">*</div>
        <img src={badge.logoSrc} alt="Town Square Fort Mill logo" className="name-badge-logo" />
        <p className="name-badge-member-name" style={{ fontSize: `${nameFontSizeMm}mm` }}>
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
                  <span aria-hidden>•</span>
                </div>
              )
            )
          )}
        </div>
      </div>
    </div>
  );
}
