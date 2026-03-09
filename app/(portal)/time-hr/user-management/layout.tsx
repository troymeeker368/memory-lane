import type { ReactNode } from "react";

import { requireModuleAccess } from "@/lib/auth";

export default async function UserManagementLayout({ children }: { children: ReactNode }) {
  await requireModuleAccess("user-management");
  return children;
}
