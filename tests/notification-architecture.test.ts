import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("notification migration hardens the inbox schema for workflow events", () => {
  const source = readWorkspaceFile("supabase/migrations/0060_notification_workflow_engine.sql");

  assert.equal(source.includes("add column if not exists actor_user_id"), true);
  assert.equal(source.includes("add column if not exists event_type"), true);
  assert.equal(source.includes("add column if not exists status"), true);
  assert.equal(source.includes("add column if not exists priority"), true);
  assert.equal(source.includes("add column if not exists action_url"), true);
  assert.equal(source.includes("add column if not exists event_key"), true);
  assert.equal(source.includes("idx_user_notifications_event_key"), true);
});

test("notification service exposes canonical dispatch and recipient resolution helpers", () => {
  const source = readWorkspaceFile("lib/services/notifications.ts");

  assert.equal(source.includes("export async function createNotification"), true);
  assert.equal(source.includes("export async function dispatchNotification"), true);
  assert.equal(source.includes("export async function resolveWorkflowRecipients"), true);
  assert.equal(source.includes("export async function dispatchReminderNotifications"), true);
  assert.equal(source.includes("buildNotificationEventKey"), true);
});

test("workflow milestone helper delegates to the shared notification dispatcher", () => {
  const source = readWorkspaceFile("lib/services/lifecycle-milestones.ts");

  assert.equal(source.includes('import {\n  dispatchNotification,'), true);
  assert.equal(source.includes("await dispatchNotification(input.event);"), true);
});

test("notification inbox supports dismiss actions in the portal UI", () => {
  const actionSource = readWorkspaceFile("app/(portal)/notifications/actions.ts");
  const pageSource = readWorkspaceFile("app/(portal)/notifications/page.tsx");

  assert.equal(actionSource.includes("dismissNotificationAction"), true);
  assert.equal(actionSource.includes("dismissUserNotification"), true);
  assert.equal(pageSource.includes("Dismiss"), true);
  assert.equal(pageSource.includes("notification.actionUrl"), true);
});
