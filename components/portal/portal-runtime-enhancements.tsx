"use client";

import { useEffect, useState } from "react";

import { GlobalTablePaginatorLazy } from "@/components/ui/global-table-paginator-lazy";

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void) => number;
  cancelIdleCallback?: (id: number) => void;
};

export function PortalRuntimeEnhancements() {
  const [shouldLoadPaginator, setShouldLoadPaginator] = useState(false);

  useEffect(() => {
    const idleWindow = window as IdleWindow;
    if (typeof idleWindow.requestIdleCallback === "function") {
      const handle = idleWindow.requestIdleCallback(() => {
        setShouldLoadPaginator(true);
      });
      return () => {
        if (typeof idleWindow.cancelIdleCallback === "function") {
          idleWindow.cancelIdleCallback(handle);
        }
      };
    }

    const timeout = window.setTimeout(() => {
      setShouldLoadPaginator(true);
    }, 200);

    return () => {
      window.clearTimeout(timeout);
    };
  }, []);

  return shouldLoadPaginator ? <GlobalTablePaginatorLazy /> : null;
}
