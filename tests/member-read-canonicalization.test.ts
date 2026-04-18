import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readWorkspaceFile(relativePath: string) {
  return readFileSync(relativePath, "utf8");
}

test("documentation and physician-order member lookups use shared search-first helpers", () => {
  const documentationSource = readWorkspaceFile("lib/services/documentation.ts");
  const lookupActionsSource = readWorkspaceFile("app/lookup-actions.ts");
  const physicianOrdersPageSource = readWorkspaceFile("app/(portal)/health/physician-orders/page.tsx");
  const newPhysicianOrderPageSource = readWorkspaceFile("app/(portal)/health/physician-orders/new/page.tsx");
  const sharedLookupSource = readWorkspaceFile("lib/services/shared-lookups-supabase.ts");

  assert.equal(documentationSource.includes("listActiveMemberLookupSupabase"), false);
  assert.equal(documentationSource.includes('from("members")'), false);

  assert.equal(lookupActionsSource.includes("searchDocumentationMembersAction"), true);
  assert.equal(lookupActionsSource.includes("searchPhysicianOrderMembersAction"), true);
  assert.equal(lookupActionsSource.includes("listMemberPickerOptionsSupabase"), true);

  assert.equal(
    physicianOrdersPageSource.includes('import { listPhysicianOrderMemberLookup, listPhysicianOrdersPage } from "@/lib/services/physician-orders-read";'),
    true
  );
  assert.equal(physicianOrdersPageSource.includes("listPhysicianOrderMemberLookup({"), true);
  assert.equal(physicianOrdersPageSource.includes('from("members")'), false);

  assert.equal(newPhysicianOrderPageSource.includes("listPhysicianOrderMemberLookup({"), true);
  assert.equal(newPhysicianOrderPageSource.includes('from("members")'), false);

  assert.equal(sharedLookupSource.includes("selectedRows"), true);
  assert.equal(sharedLookupSource.includes("listMemberLookupByIds"), true);
  assert.equal(sharedLookupSource.includes("return listMemberPickerOptionsSupabase({"), true);
});

test("dashboard member data stays behind shared dashboard services", () => {
  const dashboardPageSource = readWorkspaceFile("app/(portal)/dashboard/page.tsx");

  assert.equal(dashboardPageSource.includes("getDashboardAdminSnapshot"), true);
  assert.equal(dashboardPageSource.includes("listMemberNameLookupSupabase"), false);
  assert.equal(dashboardPageSource.includes('supabase.from("members").select("id, display_name")'), false);
});

test("transportation add-rider member options reuse the shared picker boundary", () => {
  const runtimeSource = readWorkspaceFile("lib/services/member-command-center-runtime.ts");

  assert.equal(runtimeSource.includes("listMemberPickerOptionsSupabase({"), true);
  assert.equal(
    runtimeSource.includes('from("members")\n          .select("id, display_name, status")'),
    false
  );
});
