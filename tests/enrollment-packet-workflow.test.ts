import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("enrollment packet status model is canonical and ordered", () => {
  const source = readWorkspaceFile("lib/services/enrollment-packet-types.ts");
  const marker = "export const ENROLLMENT_PACKET_STATUS_VALUES = [";
  const start = source.indexOf(marker);
  assert.equal(start >= 0, true);
  const end = source.indexOf("] as const;", start);
  assert.equal(end > start, true);
  const block = source.slice(start, end);

  const statuses = ["draft", "sent", "in_progress", "expired", "completed", "voided"];
  let previousIndex = -1;
  statuses.forEach((status) => {
    const nextIndex = block.indexOf(`"${status}"`);
    assert.equal(nextIndex >= 0, true);
    assert.equal(nextIndex > previousIndex, true);
    previousIndex = nextIndex;
  });
});

test("EIP lead action and Sales standalone action both call the same server action entrypoint", () => {
  const eipActionSource = readWorkspaceFile("components/sales/send-enrollment-packet-action.tsx");
  const standaloneSource = readWorkspaceFile("components/sales/sales-enrollment-packet-standalone-action.tsx");

  assert.equal(eipActionSource.includes('from "@/app/sales-enrollment-actions";'), true);
  assert.equal(eipActionSource.includes("replaceEnrollmentPacketAction"), true);
  assert.equal(eipActionSource.includes("voidEnrollmentPacketAction"), true);
  assert.equal(standaloneSource.includes('import { sendEnrollmentPacketAction } from "@/app/sales-enrollment-actions";'), true);
  assert.equal(eipActionSource.includes("sendEnrollmentPacketAction("), true);
  assert.equal(standaloneSource.includes("sendEnrollmentPacketAction({"), true);
});

test("shared enrollment packet service persists a DOCX completed packet artifact", () => {
  const runtimeSource = readWorkspaceFile("lib/services/enrollment-packets-public-runtime.ts");
  const docxSource = readWorkspaceFile("lib/services/enrollment-packet-docx.ts");

  assert.equal(runtimeSource.includes("buildCompletedPacketArtifactData({"), true);
  assert.equal(docxSource.includes("PDFDocument.create()"), true);
  assert.equal(runtimeSource.includes('uploadCategory: "completed_packet"'), true);
});

test("sales action delegates packet send to the shared enrollment packet resolver", () => {
  const actionSource = readWorkspaceFile("app/sales-enrollment-actions.ts");

  assert.equal(actionSource.includes("sendEnrollmentPacketRequest({"), true);
  assert.equal(actionSource.includes("resolveSalesLeadId("), true);
});

test("portal notification inbox is wired to user_notifications service and route", () => {
  const layoutSource = readWorkspaceFile("app/(portal)/layout.tsx");
  const notificationPageSource = readWorkspaceFile("app/(portal)/notifications/page.tsx");

  assert.equal(layoutSource.includes('href="/notifications"'), true);
  assert.equal(layoutSource.includes("Notifications"), true);
  assert.equal(notificationPageSource.includes("listUserNotificationsForUser(profile.id"), true);
  assert.equal(notificationPageSource.includes("markNotificationReadAction"), true);
  assert.equal(notificationPageSource.includes('from "@/lib/services/notifications"'), true);
});
