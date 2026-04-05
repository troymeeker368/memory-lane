"use server";

import type {
  deleteWorkflowRecordAction as deleteWorkflowRecordActionImpl,
  setAncillaryReconciliationAction as setAncillaryReconciliationActionImpl,
  updateAncillaryAction as updateAncillaryActionImpl,
  updateBloodSugarAction as updateBloodSugarActionImpl,
  updateDailyActivityAction as updateDailyActivityActionImpl,
  updateShowerLogAction as updateShowerLogActionImpl,
  updateToiletLogAction as updateToiletLogActionImpl,
  updateTransportationLogAction as updateTransportationLogActionImpl
} from "@/app/documentation-actions-impl";
import { loadDocumentationActionsImpl } from "@/app/documentation-action-loaders";

export type DocumentationUpdateActionRequest =
  | {
      kind: "updateDailyActivity";
      payload: Parameters<typeof updateDailyActivityActionImpl>[0];
    }
  | {
      kind: "updateToiletLog";
      payload: Parameters<typeof updateToiletLogActionImpl>[0];
    }
  | {
      kind: "updateShowerLog";
      payload: Parameters<typeof updateShowerLogActionImpl>[0];
    }
  | {
      kind: "updateTransportationLog";
      payload: Parameters<typeof updateTransportationLogActionImpl>[0];
    }
  | {
      kind: "updateBloodSugar";
      payload: Parameters<typeof updateBloodSugarActionImpl>[0];
    }
  | {
      kind: "updateAncillary";
      payload: Parameters<typeof updateAncillaryActionImpl>[0];
    }
  | {
      kind: "setAncillaryReconciliation";
      payload: Parameters<typeof setAncillaryReconciliationActionImpl>[0];
    }
  | {
      kind: "deleteWorkflowRecord";
      payload: Parameters<typeof deleteWorkflowRecordActionImpl>[0];
    };

export async function runDocumentationUpdateAction(request: DocumentationUpdateActionRequest) {
  const implementation = await loadDocumentationActionsImpl();

  switch (request.kind) {
    case "updateDailyActivity":
      return implementation.updateDailyActivityAction(request.payload);
    case "updateToiletLog":
      return implementation.updateToiletLogAction(request.payload);
    case "updateShowerLog":
      return implementation.updateShowerLogAction(request.payload);
    case "updateTransportationLog":
      return implementation.updateTransportationLogAction(request.payload);
    case "updateBloodSugar":
      return implementation.updateBloodSugarAction(request.payload);
    case "updateAncillary":
      return implementation.updateAncillaryAction(request.payload);
    case "setAncillaryReconciliation":
      return implementation.setAncillaryReconciliationAction(request.payload);
    case "deleteWorkflowRecord":
      return implementation.deleteWorkflowRecordAction(request.payload);
  }
}
