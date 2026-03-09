import { PERMISSION_MODULES } from "@/lib/permissions";
import type { ManagedUser, PermissionModuleKey } from "@/types/app";

type FormAction = (formData: FormData) => void | Promise<void>;

function moduleLabel(module: PermissionModuleKey) {
  return module
    .split("-")
    .map((chunk) => chunk[0].toUpperCase() + chunk.slice(1))
    .join(" ");
}

export function UserPermissionsForm({ user, action }: { user: ManagedUser; action: FormAction }) {
  const isCustom = user.hasCustomPermissions;

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="userId" value={user.id} />
      <div className="grid gap-2 md:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span>Permission Source</span>
          <select
            className="h-11 rounded-lg border border-border px-3"
            name="permissionMode"
            defaultValue={isCustom ? "custom" : "template"}
          >
            <option value="template">Use Role Template Defaults</option>
            <option value="custom">Use Custom Overrides</option>
          </select>
        </label>
        <div className="rounded-lg border border-border px-3 py-2 text-sm text-muted">
          Effective source: <span className="font-semibold text-primary-text">{user.permissionSource}</span>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Module</th>
              <th>View</th>
              <th>Create</th>
              <th>Edit</th>
              <th>Admin</th>
            </tr>
          </thead>
          <tbody>
            {PERMISSION_MODULES.map((module) => {
              const row = user.permissions[module];
              return (
                <tr key={module}>
                  <td>{moduleLabel(module)}</td>
                  <td>
                    <input type="checkbox" name={`${module}.canView`} defaultChecked={row.canView} />
                  </td>
                  <td>
                    <input type="checkbox" name={`${module}.canCreate`} defaultChecked={row.canCreate} />
                  </td>
                  <td>
                    <input type="checkbox" name={`${module}.canEdit`} defaultChecked={row.canEdit} />
                  </td>
                  <td>
                    <input type="checkbox" name={`${module}.canAdmin`} defaultChecked={row.canAdmin} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <button type="submit" className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">
        Save Permissions
      </button>
    </form>
  );
}
