"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

import type { CarePlanReviewForm as CarePlanReviewFormComponent, NewCarePlanForm as NewCarePlanFormComponent } from "@/components/forms/care-plan-forms";

type NewCarePlanFormProps = ComponentProps<typeof NewCarePlanFormComponent>;
type CarePlanReviewFormProps = ComponentProps<typeof CarePlanReviewFormComponent>;

const NewCarePlanFormInner = dynamic<NewCarePlanFormProps>(
  () => import("@/components/forms/care-plan-forms").then((module) => module.NewCarePlanForm),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted">Loading care plan form...</div> }
);

const CarePlanReviewFormInner = dynamic<CarePlanReviewFormProps>(
  () => import("@/components/forms/care-plan-forms").then((module) => module.CarePlanReviewForm),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted">Loading review form...</div> }
);

export function NewCarePlanFormShell(props: NewCarePlanFormProps) {
  return <NewCarePlanFormInner {...props} />;
}

export function CarePlanReviewFormShell(props: CarePlanReviewFormProps) {
  return <CarePlanReviewFormInner {...props} />;
}
