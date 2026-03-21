import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("documentation and physician-order member lookups use shared canonical helpers", () => {
  const documentationSource = readWorkspaceFile("lib/services/documentation.ts");
  const physicianOrdersPageSource = readWorkspaceFile("app/(portal)/health/physician-orders/page.tsx");
  const newPhysicianOrderPageSource = readWorkspaceFile("app/(portal)/health/physician-orders/new/page.tsx");

  assert.equal(
    documentationSource.includes('import { listActiveMemberLookupSupabase } from "@/lib/services/shared-lookups-supabase";'),
    true
  );
  assert.equal(documentationSource.includes("return listActiveMemberLookupSupabase();"), true);
  assert.equal(documentationSource.includes('from("members")'), false);

  assert.equal(
    physicianOrdersPageSource.includes('import { listActiveMemberLookupSupabase } from "@/lib/services/shared-lookups-supabase";'),
    true
  );
  assert.equal(physicianOrdersPageSource.includes("const members = await listActiveMemberLookupSupabase();"), true);
  assert.equal(physicianOrdersPageSource.includes('from("members")'), false);

  assert.equal(
    newPhysicianOrderPageSource.includes("listPhysicianOrderMemberLookup"),
    true
  );
  assert.equal(newPhysicianOrderPageSource.includes('from("members")'), false);
});

test("dashboard member-name lookups use the shared MCC member list service", () => {
  const dashboardPageSource = readWorkspaceFile("app/(portal)/dashboard/page.tsx");

  assert.equal(
    dashboardPageSource.includes('import { listMemberNameLookupSupabase } from "@/lib/services/member-command-center-read";'),
    true
  );
  assert.equal(dashboardPageSource.includes('listMemberNameLookupSupabase({ status: "all" })'), true);
  assert.equal(dashboardPageSource.includes('supabase.from("members").select("id, display_name")'), false);
});
