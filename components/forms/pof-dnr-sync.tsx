"use client";

import { useEffect } from "react";

export const POF_DNR_SELECTED_INPUT_ID = "pof-dnr-selected";
export const POF_DNR_FLAG_INPUT_ID = "pof-flag-dnr";

export function PofDnrSync() {
  useEffect(() => {
    const dnrSelectedInput = document.getElementById(POF_DNR_SELECTED_INPUT_ID) as HTMLInputElement | null;
    const dnrFlagInput = document.getElementById(POF_DNR_FLAG_INPUT_ID) as HTMLInputElement | null;
    if (!dnrSelectedInput || !dnrFlagInput) return;

    const syncFlagFromSelected = () => {
      dnrFlagInput.checked = dnrSelectedInput.checked;
    };

    const handleSelectedChange = () => {
      syncFlagFromSelected();
    };

    const handleFlagChange = () => {
      syncFlagFromSelected();
    };

    syncFlagFromSelected();
    dnrSelectedInput.addEventListener("change", handleSelectedChange);
    dnrFlagInput.addEventListener("change", handleFlagChange);

    return () => {
      dnrSelectedInput.removeEventListener("change", handleSelectedChange);
      dnrFlagInput.removeEventListener("change", handleFlagChange);
    };
  }, []);

  return null;
}
