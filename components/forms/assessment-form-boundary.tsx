"use client";

import type { ComponentProps } from "react";

import { AssessmentFormShell } from "@/components/forms/workflow-forms-shells";

type AssessmentFormBoundaryProps = ComponentProps<typeof AssessmentFormShell>;

export function AssessmentFormBoundary(props: AssessmentFormBoundaryProps) {
  return <AssessmentFormShell {...props} />;
}
