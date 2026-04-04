"use client";

import { Card, CardBody, CardTitle } from "@/components/ui/card";

export default function SalesError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Sales Workspace Unavailable</CardTitle>
        <CardBody>
          <p className="text-sm text-danger">{error.message || "Unable to load the sales workspace right now."}</p>
          <button type="button" onClick={reset} className="mt-3 rounded-lg border border-border px-3 py-2 text-sm font-semibold">
            Retry
          </button>
        </CardBody>
      </Card>
    </div>
  );
}
