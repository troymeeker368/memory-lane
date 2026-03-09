import { notFound } from "next/navigation";

import { updateManagedUserPermissionsAction } from "@/lib/actions/user-management";
import { UserPermissionsForm } from "@/components/forms/user-permissions-form";
import { BackArrowButton } from "@/components/ui/back-arrow-button";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { getManagedUserById } from "@/lib/services/user-management";

export default async function ManagedUserPermissionsPage({ params }: { params: Promise<{ userId: string }> }) {
  await requireModuleAccess("user-management");
  const { userId } = await params;
  const user = getManagedUserById(userId);

  if (!user) {
    notFound();
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Manage Permissions</CardTitle>
            <p className="mt-1 text-sm text-muted">{user.displayName} module-level access controls.</p>
          </div>
          <BackArrowButton fallbackHref={`/time-hr/user-management/${user.id}`} ariaLabel="Back to user details" />
        </div>
      </Card>

      <Card>
        <UserPermissionsForm user={user} action={updateManagedUserPermissionsAction} />
      </Card>
    </div>
  );
}
