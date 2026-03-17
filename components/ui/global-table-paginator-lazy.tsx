"use client";

import dynamic from "next/dynamic";

const GlobalTablePaginator = dynamic(
  () => import("@/components/ui/global-table-paginator").then((mod) => mod.GlobalTablePaginator),
  { ssr: false }
);

export function GlobalTablePaginatorLazy() {
  return <GlobalTablePaginator />;
}
