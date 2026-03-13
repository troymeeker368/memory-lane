import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  BADGE_DISPLAY_NAME_RESOLUTION_ORDER,
  formatMemberBadgeDisplayName
} from "@/lib/services/member-badge-display-name";

test("Howard Brown -> Howard B", () => {
  const formatted = formatMemberBadgeDisplayName({
    first_name: "Howard",
    last_name: "Brown"
  });
  assert.equal(formatted.displayName, "Howard B");
});

test("Mary Jones -> Mary J", () => {
  const formatted = formatMemberBadgeDisplayName({
    first_name: "Mary",
    last_name: "Jones"
  });
  assert.equal(formatted.displayName, "Mary J");
});

test("single-name input falls back to first name only (Cher -> Cher)", () => {
  const formatted = formatMemberBadgeDisplayName({
    full_name: "Cher"
  });
  assert.equal(formatted.displayName, "Cher");
});

test("preferred_name has priority over first_name when present", () => {
  const formatted = formatMemberBadgeDisplayName({
    preferred_name: "Mary",
    first_name: "Maria",
    last_name: "Jones"
  });
  assert.equal(formatted.displayName, "Mary J");
  assert.equal(formatted.source, "preferred_name+last_name");
});

test("resolution order is canonical and stable", () => {
  assert.deepEqual(BADGE_DISPLAY_NAME_RESOLUTION_ORDER, [
    "preferred_name+last_name",
    "first_name+last_name",
    "full_name",
    "name"
  ]);
});

test("preview and export both use badge.member.displayName", () => {
  const builderSource = readFileSync("components/name-badge/name-badge-builder.tsx", "utf8");
  const actionSource = readFileSync("app/(portal)/members/[memberId]/name-badge/actions.ts", "utf8");

  assert.equal(builderSource.includes("badge.member.displayName"), true);
  assert.equal(actionSource.includes("badge.member.displayName"), true);
  assert.equal(builderSource.includes("badge.member.name.trim()"), false);
  assert.equal(actionSource.includes("badge.member.name.trim()"), false);
});
