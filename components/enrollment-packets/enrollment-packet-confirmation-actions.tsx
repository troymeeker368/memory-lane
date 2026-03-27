"use client";

import { useEffect } from "react";

export function EnrollmentPacketConfirmationActions({
  downloadHref
}: {
  downloadHref: string;
}) {
  useEffect(() => {
    const clearPrintMode = () => {
      document.body.classList.remove("print-enrollment-welcome-letter");
    };

    window.addEventListener("afterprint", clearPrintMode);
    return () => {
      window.removeEventListener("afterprint", clearPrintMode);
      clearPrintMode();
    };
  }, []);

  const printWelcomeLetter = () => {
    document.body.classList.add("print-enrollment-welcome-letter");
    window.print();
  };

  return (
    <div className="enrollment-confirmation-actions mt-4 flex flex-wrap gap-2 print-hide">
      <a
        href={downloadHref}
        className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white"
      >
        Download Enrollment Packet PDF
      </a>
      <button
        type="button"
        onClick={printWelcomeLetter}
        className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold text-fg"
      >
        Print Welcome Letter
      </button>
    </div>
  );
}
