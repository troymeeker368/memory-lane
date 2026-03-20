"use server";

import type {
  createAncillaryChargeAction as createAncillaryChargeActionImpl,
  createBloodSugarLogAction as createBloodSugarLogActionImpl,
  createDailyActivityAction as createDailyActivityActionImpl,
  createPhotoUploadAction as createPhotoUploadActionImpl,
  createShowerLogAction as createShowerLogActionImpl,
  createToiletLogAction as createToiletLogActionImpl,
  createTransportationLogAction as createTransportationLogActionImpl
} from "@/app/documentation-actions-impl";

export type DocumentationCreateActionRequest =
  | {
      kind: "createAncillaryCharge";
      payload: Parameters<typeof createAncillaryChargeActionImpl>[0];
    }
  | {
      kind: "createDailyActivity";
      payload: Parameters<typeof createDailyActivityActionImpl>[0];
    }
  | {
      kind: "createToiletLog";
      payload: Parameters<typeof createToiletLogActionImpl>[0];
    }
  | {
      kind: "createShowerLog";
      payload: Parameters<typeof createShowerLogActionImpl>[0];
    }
  | {
      kind: "createTransportationLog";
      payload: Parameters<typeof createTransportationLogActionImpl>[0];
    }
  | {
      kind: "createPhotoUpload";
      payload: Parameters<typeof createPhotoUploadActionImpl>[0];
    }
  | {
      kind: "createBloodSugarLog";
      payload: Parameters<typeof createBloodSugarLogActionImpl>[0];
    };

export async function runDocumentationCreateAction(request: DocumentationCreateActionRequest) {
  const implementation = await import("@/app/documentation-actions-impl");

  switch (request.kind) {
    case "createAncillaryCharge":
      return implementation.createAncillaryChargeAction(request.payload);
    case "createDailyActivity":
      return implementation.createDailyActivityAction(request.payload);
    case "createToiletLog":
      return implementation.createToiletLogAction(request.payload);
    case "createShowerLog":
      return implementation.createShowerLogAction(request.payload);
    case "createTransportationLog":
      return implementation.createTransportationLogAction(request.payload);
    case "createPhotoUpload":
      return implementation.createPhotoUploadAction(request.payload);
    case "createBloodSugarLog":
      return implementation.createBloodSugarLogAction(request.payload);
  }
}
