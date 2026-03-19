"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

import type { IncidentForm as IncidentFormComponent } from "@/components/incidents/incident-form";

type IncidentFormProps = ComponentProps<typeof IncidentFormComponent>;

const IncidentFormInner = dynamic<IncidentFormProps>(
  () => import("@/components/incidents/incident-form").then((module) => module.IncidentForm),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted">Loading incident form...</div> }
);

export function IncidentFormShell(props: IncidentFormProps) {
  return <IncidentFormInner {...props} />;
}
