"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

import type { MhpAllergiesSection as MhpAllergiesSectionComponent } from "@/components/forms/mhp-allergies-section";
import type { MhpDiagnosesSection as MhpDiagnosesSectionComponent } from "@/components/forms/mhp-diagnoses-section";
import type { MhpEquipmentSection as MhpEquipmentSectionComponent } from "@/components/forms/mhp-equipment-section";
import type { MhpLegalForm as MhpLegalFormComponent } from "@/components/forms/mhp-legal-form";
import type { MhpMedicationsSection as MhpMedicationsSectionComponent } from "@/components/forms/mhp-medications-section";
import type { MhpNotesSection as MhpNotesSectionComponent } from "@/components/forms/mhp-notes-section";
import type { MhpOverviewForm as MhpOverviewFormComponent } from "@/components/forms/mhp-overview-form";
import type { MhpPhotoUploader as MhpPhotoUploaderComponent } from "@/components/forms/mhp-photo-uploader";
import type { MhpProvidersSection as MhpProvidersSectionComponent } from "@/components/forms/mhp-providers-section";
import type { MhpTrackBannerEditor as MhpTrackBannerEditorComponent } from "@/components/forms/mhp-track-banner-editor";

type MhpOverviewFormProps = ComponentProps<typeof MhpOverviewFormComponent>;
type MhpLegalFormProps = ComponentProps<typeof MhpLegalFormComponent>;
type MhpPhotoUploaderProps = ComponentProps<typeof MhpPhotoUploaderComponent>;
type MhpTrackBannerEditorProps = ComponentProps<typeof MhpTrackBannerEditorComponent>;
type MhpDiagnosesSectionProps = ComponentProps<typeof MhpDiagnosesSectionComponent>;
type MhpProvidersSectionProps = ComponentProps<typeof MhpProvidersSectionComponent>;
type MhpMedicationsSectionProps = ComponentProps<typeof MhpMedicationsSectionComponent>;
type MhpAllergiesSectionProps = ComponentProps<typeof MhpAllergiesSectionComponent>;
type MhpEquipmentSectionProps = ComponentProps<typeof MhpEquipmentSectionComponent>;
type MhpNotesSectionProps = ComponentProps<typeof MhpNotesSectionComponent>;

const MhpOverviewFormInner = dynamic<MhpOverviewFormProps>(
  () => import("@/components/forms/mhp-overview-form").then((module) => module.MhpOverviewForm),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted">Loading overview form...</div> }
);

const MhpLegalFormInner = dynamic<MhpLegalFormProps>(
  () => import("@/components/forms/mhp-legal-form").then((module) => module.MhpLegalForm),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted">Loading legal form...</div> }
);

const MhpPhotoUploaderInner = dynamic<MhpPhotoUploaderProps>(
  () => import("@/components/forms/mhp-photo-uploader").then((module) => module.MhpPhotoUploader),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted">Loading photo uploader...</div> }
);

const MhpTrackBannerEditorInner = dynamic<MhpTrackBannerEditorProps>(
  () => import("@/components/forms/mhp-track-banner-editor").then((module) => module.MhpTrackBannerEditor),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted">Loading track details...</div> }
);

const MhpDiagnosesSectionInner = dynamic<MhpDiagnosesSectionProps>(
  () => import("@/components/forms/mhp-diagnoses-section").then((module) => module.MhpDiagnosesSection),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted">Loading diagnoses...</div> }
);

const MhpProvidersSectionInner = dynamic<MhpProvidersSectionProps>(
  () => import("@/components/forms/mhp-providers-section").then((module) => module.MhpProvidersSection),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted">Loading providers...</div> }
);

const MhpMedicationsSectionInner = dynamic<MhpMedicationsSectionProps>(
  () => import("@/components/forms/mhp-medications-section").then((module) => module.MhpMedicationsSection),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted">Loading medications...</div> }
);

const MhpAllergiesSectionInner = dynamic<MhpAllergiesSectionProps>(
  () => import("@/components/forms/mhp-allergies-section").then((module) => module.MhpAllergiesSection),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted">Loading allergies...</div> }
);

const MhpEquipmentSectionInner = dynamic<MhpEquipmentSectionProps>(
  () => import("@/components/forms/mhp-equipment-section").then((module) => module.MhpEquipmentSection),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted">Loading equipment...</div> }
);

const MhpNotesSectionInner = dynamic<MhpNotesSectionProps>(
  () => import("@/components/forms/mhp-notes-section").then((module) => module.MhpNotesSection),
  { ssr: false, loading: () => <div className="p-4 text-sm text-muted">Loading notes...</div> }
);

export function MhpOverviewForm(props: MhpOverviewFormProps) {
  return <MhpOverviewFormInner {...props} />;
}

export function MhpLegalForm(props: MhpLegalFormProps) {
  return <MhpLegalFormInner {...props} />;
}

export function MhpPhotoUploader(props: MhpPhotoUploaderProps) {
  return <MhpPhotoUploaderInner {...props} />;
}

export function MhpTrackBannerEditor(props: MhpTrackBannerEditorProps) {
  return <MhpTrackBannerEditorInner {...props} />;
}

export function MhpDiagnosesSection(props: MhpDiagnosesSectionProps) {
  return <MhpDiagnosesSectionInner {...props} />;
}

export function MhpProvidersSection(props: MhpProvidersSectionProps) {
  return <MhpProvidersSectionInner {...props} />;
}

export function MhpMedicationsSection(props: MhpMedicationsSectionProps) {
  return <MhpMedicationsSectionInner {...props} />;
}

export function MhpAllergiesSection(props: MhpAllergiesSectionProps) {
  return <MhpAllergiesSectionInner {...props} />;
}

export function MhpEquipmentSection(props: MhpEquipmentSectionProps) {
  return <MhpEquipmentSectionInner {...props} />;
}

export function MhpNotesSection(props: MhpNotesSectionProps) {
  return <MhpNotesSectionInner {...props} />;
}
