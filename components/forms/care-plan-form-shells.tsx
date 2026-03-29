"use client";

import type { ComponentProps } from "react";

import { CarePlanReviewForm, NewCarePlanForm } from "@/components/forms/care-plan-forms";

type NewCarePlanFormProps = ComponentProps<typeof NewCarePlanForm>;
type CarePlanReviewFormProps = ComponentProps<typeof CarePlanReviewForm>;

export function NewCarePlanFormShell(props: NewCarePlanFormProps) {
  return <NewCarePlanForm {...props} />;
}

export function CarePlanReviewFormShell(props: CarePlanReviewFormProps) {
  return <CarePlanReviewForm {...props} />;
}
