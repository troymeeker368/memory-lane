import type React from "react";
import Link from "next/link";
import Image from "next/image";

import { getCurrentProfile } from "@/lib/auth";
import { DevRoleSwitcher } from "@/components/dev-role-switcher";
import { PortalNav } from "@/components/portal-nav";
import { SignOutForm } from "@/components/sign-out-form";
import { GlobalTablePaginator } from "@/components/ui/global-table-paginator";
import { getDevRoleOverrideFromEnv, isDevelopmentMode } from "@/lib/runtime";
import { countUnreadUserNotificationsForUser } from "@/lib/services/notifications";

export default async function PortalLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();
  const showDevRoleSwitcher = isDevelopmentMode();
  const envRoleOverride = getDevRoleOverrideFromEnv();
  const unreadNotifications = await countUnreadUserNotificationsForUser(profile.id);

  return (
    <div className="portal-shell mx-auto grid min-h-screen w-full max-w-7xl gap-4 p-3 md:grid-cols-[270px_minmax(0,1fr)] md:p-4">
      <aside className="space-y-4 rounded-xl border border-white/20 bg-brand p-3 text-white md:sticky md:top-4 md:h-[calc(100vh-2rem)] md:overflow-y-auto">
        <div className="text-white">
          <Link href="/" className="mb-2 block">
            <Image
              src="/memory-lane-logo.png"
              alt="Memory Lane logo"
              width={260}
              height={156}
              className="h-auto w-full max-w-[260px]"
              priority
            />
          </Link>
          <p className="text-xs font-semibold text-white/90">Current User:</p>
          <p className="mt-1 text-sm font-semibold text-white">{profile.full_name}</p>
        </div>
        <PortalNav role={profile.role} permissions={profile.permissions} />
        <SignOutForm />
      </aside>
      <main className="space-y-4 pb-10">
        <div className="flex items-center justify-between rounded-lg border border-border bg-white px-3 py-2">
          <div>
            <p className="text-sm font-semibold text-brand">Memory Lane</p>
            <p className="text-xs text-muted">Operations Portal</p>
          </div>
          <DevRoleSwitcher
            currentRole={profile.role}
            enabled={showDevRoleSwitcher}
            envRoleOverride={envRoleOverride}
          />
          <div className="flex items-center gap-3">
            <Link href="/notifications" className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-brand hover:bg-slate-50">
              Notifications{unreadNotifications > 0 ? ` (${unreadNotifications})` : ""}
            </Link>
            <GlobalTablePaginator />
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
