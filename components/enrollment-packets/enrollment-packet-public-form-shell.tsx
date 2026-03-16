"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

import type { EnrollmentPacketPublicForm } from "@/components/enrollment-packets/enrollment-packet-public-form";

type EnrollmentPacketPublicFormProps = ComponentProps<typeof EnrollmentPacketPublicForm>;

const EnrollmentPacketPublicFormInner = dynamic(
  () =>
    import("@/components/enrollment-packets/enrollment-packet-public-form").then(
      (module) => module.EnrollmentPacketPublicForm
    ),
  {
    ssr: false,
    loading: () => <div className="p-4 text-sm text-muted">Loading enrollment packet form...</div>
  }
);

export function EnrollmentPacketPublicFormShell(props: EnrollmentPacketPublicFormProps) {
  return <EnrollmentPacketPublicFormInner {...props} />;
}
