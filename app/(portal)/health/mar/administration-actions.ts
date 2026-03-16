"use server";

import type {
  recordPrnMarAdministrationAction as recordPrnMarAdministrationActionImpl,
  recordPrnOutcomeAction as recordPrnOutcomeActionImpl,
  recordScheduledMarAdministrationAction as recordScheduledMarAdministrationActionImpl
} from "./actions-impl";

type RecordScheduledMarAdministrationInput = Parameters<typeof recordScheduledMarAdministrationActionImpl>[0];
type RecordPrnMarAdministrationInput = Parameters<typeof recordPrnMarAdministrationActionImpl>[0];
type RecordPrnOutcomeInput = Parameters<typeof recordPrnOutcomeActionImpl>[0];

export async function recordScheduledMarAdministrationAction(raw: RecordScheduledMarAdministrationInput) {
  const { recordScheduledMarAdministrationAction } = await import("./actions-impl");
  return recordScheduledMarAdministrationAction(raw);
}

export async function recordPrnMarAdministrationAction(raw: RecordPrnMarAdministrationInput) {
  const { recordPrnMarAdministrationAction } = await import("./actions-impl");
  return recordPrnMarAdministrationAction(raw);
}

export async function recordPrnOutcomeAction(raw: RecordPrnOutcomeInput) {
  const { recordPrnOutcomeAction } = await import("./actions-impl");
  return recordPrnOutcomeAction(raw);
}
