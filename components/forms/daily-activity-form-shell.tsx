"use client";

import dynamic from "next/dynamic";

type DailyActivityFormProps = Record<string, never>;

const DailyActivityFormInner = dynamic<DailyActivityFormProps>(
  () => import("@/components/forms/daily-activity-form").then((module) => module.DailyActivityForm),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted">Loading participation form...</div> }
);

export function DailyActivityFormShell(props: DailyActivityFormProps) {
  return <DailyActivityFormInner {...props} />;
}
