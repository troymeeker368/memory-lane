import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("member detail bounds care-plan preview reads but preserves canonical total count", () => {
  const readModelSource = readWorkspaceFile("lib/services/member-detail-read-model.ts");
  const carePlanSource = readWorkspaceFile("lib/services/care-plans-read-model.ts");
  const pageSource = readWorkspaceFile("app/(portal)/members/[memberId]/page.tsx");

  assert.equal(readModelSource.includes("const MEMBER_DETAIL_CARE_PLAN_PREVIEW_LIMIT = 25;"), true);
  assert.equal(readModelSource.includes("getMemberCarePlanPreview(canonicalMemberId, {"), true);
  assert.equal(readModelSource.includes("rowLimit: MEMBER_DETAIL_CARE_PLAN_PREVIEW_LIMIT"), true);
  assert.equal(readModelSource.includes("carePlansCount: carePlanReadModel?.carePlanCount ?? 0"), true);
  assert.equal(carePlanSource.includes('resolveCarePlanMemberId(memberId, "getMemberCarePlanPreview", options)'), true);
  assert.equal(carePlanSource.includes('supabase.from("care_plans").select("id", { count: "exact", head: true }).eq("member_id", canonicalMemberId)'), true);
  assert.equal(pageSource.includes("count={detail.carePlansCount}"), true);
  assert.equal(
    pageSource.includes(
      "detail.counts.bloodSugar + detail.marToday.length + (canViewCarePlans ? detail.carePlansCount : 0)"
    ),
    true
  );
});
