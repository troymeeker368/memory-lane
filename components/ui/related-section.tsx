import type React from "react";
import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";

export function RelatedSection({
  title,
  count,
  viewAllHref,
  addHref,
  children
}: {
  title: string;
  count: number;
  viewAllHref?: string;
  addHref?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>
          {title} ({count})
        </CardTitle>
        <div className="flex items-center gap-3 text-sm">
          {viewAllHref ? (
            <Link href={viewAllHref} className="font-semibold text-brand">
              View All
            </Link>
          ) : null}
          {addHref ? (
            <Link href={addHref} className="font-semibold text-brand">
              Add New
            </Link>
          ) : null}
        </div>
      </div>
      <div className="mt-3">{children}</div>
    </Card>
  );
}
