import assert from "node:assert/strict";
import test from "node:test";

import { calculateLatePickupFee } from "@/lib/services/operations-settings";

const rules = {
  graceStartTime: "16:30",
  firstWindowMinutes: 15,
  firstWindowFeeCents: 2500,
  additionalPerMinuteCents: 200,
  additionalMinutesCap: 30
} as const;

test("late pickup charges the first-window flat fee through minute 15", () => {
  const result = calculateLatePickupFee({
    latePickupTime: "16:45",
    rules
  });

  assert.deepEqual(result, {
    minutesLate: 15,
    amountCents: 2500
  });
});

test("late pickup starts the per-minute add-on at minute 16", () => {
  const result = calculateLatePickupFee({
    latePickupTime: "16:46",
    rules
  });

  assert.deepEqual(result, {
    minutesLate: 16,
    amountCents: 2700
  });
});

test("late pickup caps the per-minute add-on at the configured max window", () => {
  const result = calculateLatePickupFee({
    latePickupTime: "17:15",
    rules
  });

  assert.deepEqual(result, {
    minutesLate: 45,
    amountCents: 8500
  });
});

test("late pickup stays capped after 17:15", () => {
  const result = calculateLatePickupFee({
    latePickupTime: "17:20",
    rules
  });

  assert.deepEqual(result, {
    minutesLate: 50,
    amountCents: 8500
  });
});
