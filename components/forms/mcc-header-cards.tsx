"use client";

import { useEffect, useState } from "react";

export function MccHeaderCards({
  memberId,
  lockerNumber,
  dob,
  enrollment,
  initialCodeStatus,
  initialPhotoConsent,
  initialTransportation,
  trackLabel,
  trackSource
}: {
  memberId: string;
  lockerNumber: string | null;
  dob: string;
  enrollment: string;
  initialCodeStatus: string;
  initialPhotoConsent: boolean | null;
  initialTransportation: string;
  trackLabel: string;
  trackSource: string;
}) {
  const [codeStatus, setCodeStatus] = useState(initialCodeStatus);
  const [photoConsent, setPhotoConsent] = useState<boolean | null>(initialPhotoConsent);
  const [transportation, setTransportation] = useState(initialTransportation);

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<{
        codeStatus?: string;
        photoConsent?: boolean | null;
        transportation?: string;
      }>;
      if (custom.detail?.codeStatus !== undefined) {
        setCodeStatus(custom.detail.codeStatus || "-");
      }
      if (custom.detail?.photoConsent !== undefined) {
        setPhotoConsent(custom.detail.photoConsent);
      }
      if (custom.detail?.transportation !== undefined) {
        setTransportation(custom.detail.transportation || "-");
      }
    };
    window.addEventListener("mcc:header-update", handler as EventListener);
    return () => window.removeEventListener("mcc:header-update", handler as EventListener);
  }, []);

  const codeStatusStyle =
    codeStatus === "DNR"
      ? { color: "#b91c1c" }
      : codeStatus === "Full Code"
        ? { color: "#99CC33" }
        : undefined;
  const photoConsentLabel = photoConsent == null ? "-" : photoConsent ? "Yes" : "No";
  const photoConsentStyle =
    photoConsent === true
      ? { color: "#99CC33" }
      : photoConsent === false
        ? { color: "#b91c1c" }
        : undefined;
  const transportStyle =
    transportation === "Door to Door" || transportation === "Bus Stop"
      ? { color: "#1b3e93" }
      : transportation === "Mixed"
        ? { color: "#b46a00" }
        : transportation === "No" || transportation === "None"
        ? { color: "#4e4e4e" }
        : undefined;
  const lockerValue = (lockerNumber ?? "").trim() || "-";
  const lockerHref = lockerValue !== "-"
    ? `/operations/locker-assignments?locker=${encodeURIComponent(lockerValue)}&memberId=${encodeURIComponent(memberId)}`
    : "/operations/locker-assignments";

  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-7">
      <div className="rounded-lg border border-border p-3 text-center"><p className="text-xs text-muted">DOB</p><p className="font-semibold">{dob}</p></div>
      <div className="rounded-lg border border-border p-3 text-center"><p className="text-xs text-muted">Enrollment</p><p className="font-semibold">{enrollment}</p></div>
      <div className="rounded-lg border border-border p-3 text-center"><p className="text-xs text-muted">Code Status</p><p className="font-semibold" style={codeStatusStyle}>{codeStatus}</p></div>
      <div className="rounded-lg border border-border p-3 text-center"><p className="text-xs text-muted">Photo Consent</p><p className="font-semibold" style={photoConsentStyle}>{photoConsentLabel}</p></div>
      <a href={lockerHref} className="rounded-lg border border-border p-3 text-center hover:border-brand/50 hover:bg-brand/5">
        <p className="text-xs text-muted">Locker #</p>
        <p className="font-semibold text-brand">{lockerValue}</p>
      </a>
      <div className="rounded-lg border border-border p-3 text-center"><p className="text-xs text-muted">Transportation</p><p className="font-semibold" style={transportStyle}>{transportation}</p></div>
      <div className="rounded-lg border border-border p-3 text-center">
        <p className="text-xs text-muted">Track #</p>
        <p className="font-semibold">{trackLabel}</p>
      </div>
    </div>
  );
}
