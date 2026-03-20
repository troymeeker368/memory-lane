import assert from "node:assert/strict";
import test from "node:test";

import {
  selectMemberWithFallback,
  selectMembersPageWithFallback,
  selectMembersWithFallback
} from "./member-command-center-member-queries";

const isMissingMembersColumnError = (error: { message?: string | null } | null | undefined, tableName: string) =>
  String(error?.message ?? "").includes(`${tableName}.`) && String(error?.message ?? "").includes("does not exist");

test("selectMembersWithFallback maps current canonical legal name columns into MCC member shape", async () => {
  const rows = await selectMembersWithFallback(
    async (selectClause) => {
      assert.match(selectClause, /first_name:legal_first_name/);
      assert.match(selectClause, /last_name:legal_last_name/);
      return {
        data: [
          {
            id: "member-1",
            display_name: "Jane Smith",
            preferred_name: "Jane",
            first_name: "Janette",
            last_name: "Smith",
            status: "active",
            locker_number: "12",
            enrollment_date: "2026-01-10",
            dob: "1950-05-11",
            city: "Queens",
            code_status: "Full Code",
            latest_assessment_track: "Track A"
          }
        ],
        error: null
      };
    },
    isMissingMembersColumnError,
    "Unable to query members."
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.preferred_name, "Jane");
  assert.equal(rows[0]?.first_name, "Janette");
  assert.equal(rows[0]?.last_name, "Smith");
  assert.equal(rows[0]?.name, "Jane Smith");
  assert.equal(rows[0]?.full_name, "Jane Smith");
});

test("member queries retry with baseline schema when newer name columns are unavailable", async () => {
  const seenSelects: string[] = [];
  const page = await selectMembersPageWithFallback(
    async (selectClause) => {
      seenSelects.push(selectClause);
      if (seenSelects.length === 1) {
        return {
          data: null,
          error: { message: 'column members.preferred_name does not exist' },
          count: null
        };
      }
      return {
        data: [
          {
            id: "member-2",
            display_name: "Robert Jones",
            status: "active",
            locker_number: "8",
            enrollment_date: "2025-08-15",
            dob: "1948-02-03",
            city: "Brooklyn",
            code_status: "DNR",
            latest_assessment_track: "Track B"
          }
        ],
        error: null,
        count: 1
      };
    },
    isMissingMembersColumnError,
    "Unable to query members."
  );

  assert.equal(seenSelects.length, 2);
  assert.match(seenSelects[0] ?? "", /preferred_name/);
  assert.doesNotMatch(seenSelects[1] ?? "", /preferred_name/);
  assert.equal(page.totalRows, 1);
  assert.equal(page.rows[0]?.preferred_name, null);
  assert.equal(page.rows[0]?.first_name, null);
  assert.equal(page.rows[0]?.last_name, null);
  assert.equal(page.rows[0]?.name, "Robert Jones");
  assert.equal(page.rows[0]?.full_name, "Robert Jones");

  const member = await selectMemberWithFallback(
    async () => ({
      data: {
        id: "member-3",
        display_name: "Alice Doe",
        status: "inactive",
        locker_number: null,
        enrollment_date: null,
        dob: null,
        city: null,
        code_status: null,
        latest_assessment_track: null
      },
      error: null
    }),
    isMissingMembersColumnError,
    "Unable to fetch member."
  );

  assert.equal(member?.name, "Alice Doe");
  assert.equal(member?.full_name, "Alice Doe");
});

test("member queries still surface schema-out-of-date errors when required MCC member columns are missing", async () => {
  await assert.rejects(
    () =>
      selectMembersWithFallback(
        async (selectClause) => ({
          data: null,
          error: selectClause.includes("preferred_name")
            ? { message: "column members.preferred_name does not exist" }
            : { message: "column members.locker_number does not exist" }
        }),
        isMissingMembersColumnError,
        "Unable to query members."
      ),
    /Database schema is out of date for members in Member Command Center/
  );
});
