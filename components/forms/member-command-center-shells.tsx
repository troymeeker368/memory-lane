"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

import type { MemberCommandCenterContactManager } from "@/components/forms/member-command-center-contact-manager";
import type { MemberCommandCenterFileManager } from "@/components/forms/member-command-center-file-manager";
import type { MemberCommandCenterPofSection } from "@/components/forms/member-command-center-pof-section";
import type { MccTransportationForm } from "@/components/forms/mcc-transportation-form";

type MemberCommandCenterContactManagerProps = ComponentProps<typeof MemberCommandCenterContactManager>;
type MemberCommandCenterFileManagerProps = ComponentProps<typeof MemberCommandCenterFileManager>;
type MemberCommandCenterPofSectionProps = ComponentProps<typeof MemberCommandCenterPofSection>;
type MccTransportationFormProps = ComponentProps<typeof MccTransportationForm>;

const MemberCommandCenterContactManagerInner = dynamic<MemberCommandCenterContactManagerProps>(
  () =>
    import("@/components/forms/member-command-center-contact-manager").then(
      (module) => module.MemberCommandCenterContactManager
    ),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted">Loading contacts...</div> }
);

const MemberCommandCenterFileManagerInner = dynamic<MemberCommandCenterFileManagerProps>(
  () =>
    import("@/components/forms/member-command-center-file-manager").then(
      (module) => module.MemberCommandCenterFileManager
    ),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted">Loading files...</div> }
);

const MemberCommandCenterPofSectionInner = dynamic<MemberCommandCenterPofSectionProps>(
  () =>
    import("@/components/forms/member-command-center-pof-section").then(
      (module) => module.MemberCommandCenterPofSection
    ),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted">Loading physician orders...</div> }
);

const MccTransportationFormInner = dynamic<MccTransportationFormProps>(
  () => import("@/components/forms/mcc-transportation-form").then((module) => module.MccTransportationForm),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted">Loading transportation form...</div> }
);

export function MemberCommandCenterContactManagerShell(props: MemberCommandCenterContactManagerProps) {
  return <MemberCommandCenterContactManagerInner {...props} />;
}

export function MemberCommandCenterFileManagerShell(props: MemberCommandCenterFileManagerProps) {
  return <MemberCommandCenterFileManagerInner {...props} />;
}

export function MemberCommandCenterPofSectionShell(props: MemberCommandCenterPofSectionProps) {
  return <MemberCommandCenterPofSectionInner {...props} />;
}

export function MccTransportationFormShell(props: MccTransportationFormProps) {
  return <MccTransportationFormInner {...props} />;
}
