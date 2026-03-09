import type { ManagedUser } from "@/types/app";
import { CANONICAL_ROLE_ORDER, getRoleLabel, normalizeRoleKey } from "@/lib/permissions";

type FormAction = (formData: FormData) => void | Promise<void>;

export function UserManagementForm({
  action,
  user,
  submitLabel
}: {
  action: FormAction;
  user?: ManagedUser;
  submitLabel: string;
}) {
  return (
    <form action={action} className="grid gap-3 md:grid-cols-2">
      {user ? <input type="hidden" name="userId" value={user.id} /> : null}

      <label className="grid gap-1 text-sm">
        <span>First Name</span>
        <input className="h-11 rounded-lg border border-border px-3" name="firstName" defaultValue={user?.firstName ?? ""} required />
      </label>

      <label className="grid gap-1 text-sm">
        <span>Last Name</span>
        <input className="h-11 rounded-lg border border-border px-3" name="lastName" defaultValue={user?.lastName ?? ""} required />
      </label>

      <label className="grid gap-1 text-sm md:col-span-2">
        <span>Display Name</span>
        <input className="h-11 rounded-lg border border-border px-3" name="displayName" defaultValue={user?.displayName ?? ""} required />
      </label>

      <label className="grid gap-1 text-sm md:col-span-2">
        <span>Credentials (optional)</span>
        <input
          className="h-11 rounded-lg border border-border px-3"
          name="credentials"
          defaultValue={user?.credentials ?? ""}
          placeholder="Example: BSN, RN, CDP"
        />
      </label>

      <label className="grid gap-1 text-sm md:col-span-2">
        <span>Email</span>
        <input className="h-11 rounded-lg border border-border px-3" type="email" name="email" defaultValue={user?.email ?? ""} required />
      </label>

      <label className="grid gap-1 text-sm">
        <span>Role</span>
        <select className="h-11 rounded-lg border border-border px-3" name="role" defaultValue={normalizeRoleKey(user?.role ?? "program-assistant")}>
          {CANONICAL_ROLE_ORDER.map((role) => (
            <option key={role} value={role}>
              {getRoleLabel(role)}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-1 text-sm">
        <span>Status</span>
        <select className="h-11 rounded-lg border border-border px-3" name="status" defaultValue={user?.status ?? "active"}>
          <option value="active">active</option>
          <option value="inactive">inactive</option>
        </select>
      </label>

      <label className="grid gap-1 text-sm">
        <span>Phone (optional)</span>
        <input className="h-11 rounded-lg border border-border px-3" name="phone" defaultValue={user?.phone ?? ""} />
      </label>

      <label className="grid gap-1 text-sm">
        <span>Title (optional)</span>
        <input className="h-11 rounded-lg border border-border px-3" name="title" defaultValue={user?.title ?? ""} />
      </label>

      <label className="grid gap-1 text-sm">
        <span>Department (optional)</span>
        <input className="h-11 rounded-lg border border-border px-3" name="department" defaultValue={user?.department ?? ""} />
      </label>

      <label className="grid gap-1 text-sm">
        <span>Default Landing (optional)</span>
        <input className="h-11 rounded-lg border border-border px-3" name="defaultLanding" defaultValue={user?.defaultLanding ?? "/"} />
      </label>

      <div className="md:col-span-2">
        <button type="submit" className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
