import { notFound } from "next/navigation";

import { submitManagedUserAction } from "@/lib/actions/user-management";
import { UserManagementForm } from "@/components/forms/user-management-form";
import { BackArrowButton } from "@/components/ui/back-arrow-button";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";
import { getManagedUserById } from "@/lib/services/user-management";

export default async function EditManagedUserPage({ params }: { params: Promise<{ userId: string }> }) {
  await requireModuleAccess("user-management");
  const { userId } = await params;
  const user = await getManagedUserById(userId);

  if (!user) {
    notFound();
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Edit User</CardTitle>
            <p className="mt-1 text-sm text-muted">Update profile fields, role, and baseline account status.</p>
          </div>
          <BackArrowButton fallbackHref="/time-hr/user-management" ariaLabel="Back to user management list" />
        </div>
      </Card>

      <Card>
        <UserManagementForm
          action={submitManagedUserAction}
          intent="updateManagedUserForm"
          user={user}
          submitLabel="Save User"
        />
      </Card>
    </div>
  );
}
