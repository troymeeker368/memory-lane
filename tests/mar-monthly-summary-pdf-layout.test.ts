import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildMarSummaryGridRows } from "@/lib/services/mar-monthly-summary-layout";
import type { MarMonthlyReportData } from "@/lib/services/mar-monthly-report";

function createFixtureReport(): MarMonthlyReportData {
  return {
    reportType: "summary",
    month: {
      value: "2026-03",
      label: "March 2026",
      year: 2026,
      monthNumber: 3,
      startDate: "2026-03-01",
      endDate: "2026-03-31"
    },
    facility: {
      name: "Town Square Fort Mill",
      address: "368 Fort Mill Parkway, Suite 106, Fort Mill, SC 29715",
      phone: "803-591-9898",
      confidentialityFooter: "Confidential health information. Handle and distribute per HIPAA and organizational policy."
    },
    member: {
      id: "member-1",
      fullName: "Angela Carver",
      dob: "1937-08-16",
      identifier: "10092620250445500801",
      status: "active"
    },
    generatedAt: "2026-03-28T22:23:00.000Z",
    generatedBy: {
      name: "Arzu Uranli",
      role: "admin"
    },
    medications: [
      {
        pofMedicationId: "pof-1",
        medicationName: "Donepezil",
        strength: "10 mg",
        dose: "1 tablet",
        route: "PO",
        sig: "Daily",
        frequency: "Daily",
        scheduledTimes: ["09:00"],
        prn: false,
        prnInstructions: null,
        startDate: "2025-12-14",
        endDate: null,
        provider: "Dr. Morgan White",
        active: true
      }
    ],
    medicationRollups: [
      {
        pofMedicationId: "pof-1",
        medicationName: "Donepezil",
        scheduledExpectedCount: 2,
        givenCount: 1,
        notGivenCount: 1,
        refusedCount: 1,
        heldCount: 0,
        unavailableCount: 0,
        omittedCount: 0,
        otherExceptionCount: 0,
        prnAdministrationCount: 0,
        prnEffectiveCount: 0,
        prnIneffectiveCount: 0,
        lastAdministrationAt: "2026-03-02T14:00:00.000Z",
        lastExceptionAt: "2026-03-02T14:00:00.000Z"
      }
    ],
    exceptions: [
      {
        id: "exception-1",
        eventType: "scheduled-not-given",
        dateTime: "2026-03-02T14:00:00.000Z",
        medicationName: "Donepezil",
        scheduledTime: "2026-03-02T14:00:00.000Z",
        administeredTime: "2026-03-02T14:00:00.000Z",
        outcome: "Not Given",
        reason: "Refused",
        staffName: "Trish Church",
        notes: "Resident declined dose."
      }
    ],
    prnRows: [],
    detailRows: [
      {
        id: "admin-1",
        pofMedicationId: "pof-1",
        medicationName: "Donepezil",
        source: "scheduled",
        status: "Given",
        dueTime: "2026-03-01T14:00:00.000Z",
        administeredAt: "2026-03-01T14:02:00.000Z",
        reason: null,
        prnReason: null,
        prnOutcome: null,
        prnFollowupNote: null,
        staffName: "Trish Church",
        notes: null
      },
      {
        id: "admin-2",
        pofMedicationId: "pof-1",
        medicationName: "Donepezil",
        source: "scheduled",
        status: "Not Given",
        dueTime: "2026-03-02T14:00:00.000Z",
        administeredAt: "2026-03-02T14:00:00.000Z",
        reason: "Refused",
        prnReason: null,
        prnOutcome: null,
        prnFollowupNote: null,
        staffName: "Trish Church",
        notes: "Resident declined dose."
      }
    ],
    staffAttribution: [
      {
        userId: "staff-1",
        staffName: "Trish Church",
        staffRole: "nurse",
        initials: "TC",
        administrationCount: 2
      }
    ],
    totals: {
      scheduledExpected: 2,
      scheduledGiven: 1,
      scheduledNotGiven: 1,
      prnAdministrations: 0,
      prnIneffective: 0,
      exceptions: 1
    },
    dataQuality: {
      hasMedicationRecords: true,
      hasMarDataForMonth: true,
      partialRecordsDetected: false,
      warnings: []
    }
  };
}

test("summary grid rows place given initials and not-given marks by calendar day", () => {
  const rows = buildMarSummaryGridRows(createFixtureReport());
  const targetRow = rows.find((row) => row.medicationName === "Donepezil" && row.timeLabel === "09:00");

  assert.notEqual(targetRow, undefined);
  assert.equal(targetRow?.cells.get(1)?.label, "TC");
  assert.equal(targetRow?.cells.get(1)?.status, "given");
  assert.equal(targetRow?.cells.get(2)?.label, "NG");
  assert.equal(targetRow?.cells.get(2)?.status, "not-given");
});

test("summary pdf renderer stays landscape and keeps notes/signature sections", () => {
  const source = readFileSync("lib/services/mar-monthly-report-pdf.ts", "utf8");

  assert.equal(source.includes("const SUMMARY_PAGE_WIDTH = 792;"), true);
  assert.equal(source.includes("const SUMMARY_PAGE_HEIGHT = 612;"), true);
  assert.equal(source.includes('"Comments / Variance Log"'), true);
  assert.equal(source.includes('"Initials / Signature Key"'), true);
});
