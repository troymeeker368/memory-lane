"use client";

import type { ComponentProps } from "react";

import { AssessmentForm } from "@/components/forms/workflow-forms";

type AssessmentFormBoundaryProps = ComponentProps<typeof AssessmentForm>;

export function AssessmentFormBoundary(props: AssessmentFormBoundaryProps) {
  return <AssessmentForm {...props} />;
}
