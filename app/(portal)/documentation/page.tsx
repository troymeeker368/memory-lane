import { requireModuleAccess } from "@/lib/auth";
import { normalizeRoleKey } from "@/lib/permissions/core";

type DocumentationPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function DocumentationPage({ searchParams }: DocumentationPageProps) {
  const profile = await requireModuleAccess("documentation");
  const normalizedRole = normalizeRoleKey(profile.role);
  const params = searchParams ? await searchParams : {};

  if (normalizedRole === "program-assistant") {
    const { StaffDocumentationHome } = await import("@/app/(portal)/documentation/staff-documentation-home");
    return <StaffDocumentationHome profileFullName={profile.full_name} searchParams={params} />;
  }

  const { DocumentationDashboardHome } = await import("@/app/(portal)/documentation/documentation-dashboard-home");
  return <DocumentationDashboardHome normalizedRole={normalizedRole} searchParams={params} />;
}
