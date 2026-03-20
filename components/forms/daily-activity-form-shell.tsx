"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

import type { DailyActivityForm as DailyActivityFormComponent } from "@/components/forms/daily-activity-form";

type DailyActivityFormProps = ComponentProps<typeof DailyActivityFormComponent>;

const DailyActivityFormInner = dynamic<DailyActivityFormProps>(
  () => import("@/components/forms/daily-activity-form").then((module) => module.DailyActivityForm),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted">Loading participation form...</div> }
);

export function DailyActivityFormShell(props: DailyActivityFormProps) {
  return <DailyActivityFormInner {...props} />;
}
