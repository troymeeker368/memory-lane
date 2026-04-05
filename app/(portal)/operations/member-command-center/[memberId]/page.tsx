import { notFound } from "next/navigation";

import { MemberCommandCenterDetailView } from "@/app/(portal)/operations/member-command-center/member-command-center-detail-view";
import {
  firstString,
  resolveTab
} from "@/app/(portal)/operations/member-command-center/member-command-center-detail-shared";
import { requireMemberCommandCenterAccess } from "@/lib/auth";
import {
  canAccessMemberHealthProfiles,
  canAccessPhysicianOrders,
  canEditMemberCommandCenter,
  canEditMemberCommandCenterAttendanceBilling,
  canGenerateMemberDocumentForRole,
  canManagePhysicianOrders,
  canManagePofSignatureWorkflow
} from "@/lib/permissions";
import { getMemberCommandCenterDetailPageReadModel } from "@/lib/services/member-command-center-detail-read-model";
import { getOperationsTodayDate, normalizeOperationalDateOnly } from "@/lib/services/operations-calendar";

export default async function MemberCommandCenterDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ memberId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireMemberCommandCenterAccess();
  const canEdit = canEditMemberCommandCenter(profile);
  const canEditAttendanceBilling = canEditMemberCommandCenterAttendanceBilling(profile);
  const canViewMhpFromMcc = canAccessMemberHealthProfiles(profile);
  const canViewFaceSheet = canGenerateMemberDocumentForRole(profile.role);
  const canViewNameBadge = canGenerateMemberDocumentForRole(profile.role);
  const canAccessPofWorkflow = canManagePofSignatureWorkflow(profile);
  const canViewPhysicianOrders = canAccessPhysicianOrders(profile);
  const canCreatePhysicianOrders = canManagePhysicianOrders(profile);
  const { memberId } = await params;
  const query = await searchParams;
  const tab = resolveTab(firstString(query.tab));
  const selectedOperationalDate = normalizeOperationalDateOnly(firstString(query.date) ?? getOperationsTodayDate());
  const successMessage = firstString(query.success) ?? null;
  const errorMessage = firstString(query.error) ?? null;

  const detailPageData = await getMemberCommandCenterDetailPageReadModel({
    memberId,
    activeTab: tab,
    canEdit,
    includePofSection: canAccessPofWorkflow,
    actorUserId: profile.id,
    actorFullName: profile.full_name
  });

  if (!detailPageData) notFound();

  return (
    <MemberCommandCenterDetailView
      detailPageData={detailPageData}
      tab={tab}
      selectedOperationalDate={selectedOperationalDate}
      successMessage={successMessage}
      errorMessage={errorMessage}
      canEdit={canEdit}
      canEditAttendanceBilling={canEditAttendanceBilling}
      canViewMhpFromMcc={canViewMhpFromMcc}
      canViewFaceSheet={canViewFaceSheet}
      canViewNameBadge={canViewNameBadge}
      canViewPhysicianOrders={canViewPhysicianOrders}
      canCreatePhysicianOrders={canCreatePhysicianOrders}
      viewerRole={profile.role}
      viewerUserId={profile.id}
    />
  );
}
