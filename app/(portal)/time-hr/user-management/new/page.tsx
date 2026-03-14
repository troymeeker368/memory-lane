import { createManagedUserFormAction } from "@/lib/actions/user-management";
import { UserManagementForm } from "@/components/forms/user-management-form";
import { BackArrowButton } from "@/components/ui/back-arrow-button";
import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";

export default async function NewManagedUserPage() {
  await requireModuleAccess("user-management");

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Add User</CardTitle>
            <p className="mt-1 text-sm text-muted">Create a new app user, assign role access, then send a set-password invite.</p>
          </div>
          <BackArrowButton fallbackHref="/time-hr/user-management" ariaLabel="Back to user list" />
        </div>
      </Card>

      <Card>
        <UserManagementForm action={createManagedUserFormAction} submitLabel="Create User" />
      </Card>
    </div>
  );
}
