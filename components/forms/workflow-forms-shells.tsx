"use client";

import dynamic from "next/dynamic";
import type { CanonicalPersonRef } from "@/types/identity";

type ToiletLogFormProps = Record<string, never>;
type ShowerLogFormProps = Record<string, never>;
type TransportationLogFormProps = Record<string, never>;
type PhotoUploadFormProps = Record<string, never>;
type BloodSugarFormProps = Record<string, never>;
type AssessmentFormProps = {
  members: CanonicalPersonRef[];
  initialMemberId?: string;
  initialStaffName?: string;
};

const ToiletLogFormInner = dynamic<ToiletLogFormProps>(
  () => import("@/components/forms/documentation-workflow-forms").then((module) => module.ToiletLogForm),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted">Loading form...</div> }
);

const ShowerLogFormInner = dynamic<ShowerLogFormProps>(
  () => import("@/components/forms/documentation-workflow-forms").then((module) => module.ShowerLogForm),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted">Loading form...</div> }
);

const TransportationLogFormInner = dynamic<TransportationLogFormProps>(
  () => import("@/components/forms/documentation-workflow-forms").then((module) => module.TransportationLogForm),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted">Loading form...</div> }
);

const PhotoUploadFormInner = dynamic<PhotoUploadFormProps>(
  () => import("@/components/forms/documentation-workflow-forms").then((module) => module.PhotoUploadForm),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted">Loading form...</div> }
);

const BloodSugarFormInner = dynamic<BloodSugarFormProps>(
  () => import("@/components/forms/documentation-workflow-forms").then((module) => module.BloodSugarForm),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted">Loading form...</div> }
);

const AssessmentFormInner = dynamic<AssessmentFormProps>(
  () => import("@/components/forms/assessment-form").then((module) => module.AssessmentForm),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted">Loading assessment form...</div> }
);

export function ToiletLogFormShell(props: ToiletLogFormProps) {
  return <ToiletLogFormInner {...props} />;
}

export function ShowerLogFormShell(props: ShowerLogFormProps) {
  return <ShowerLogFormInner {...props} />;
}

export function TransportationLogFormShell(props: TransportationLogFormProps) {
  return <TransportationLogFormInner {...props} />;
}

export function PhotoUploadFormShell(props: PhotoUploadFormProps) {
  return <PhotoUploadFormInner {...props} />;
}

export function BloodSugarFormShell(props: BloodSugarFormProps) {
  return <BloodSugarFormInner {...props} />;
}

export function AssessmentFormShell(props: AssessmentFormProps) {
  return <AssessmentFormInner {...props} />;
}
