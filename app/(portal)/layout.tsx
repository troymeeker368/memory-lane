import type React from "react";
import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import { headers } from "next/headers";

import { getCurrentProfile } from "@/lib/auth";
import { isDevAuthBypassEnabled } from "@/lib/runtime";
import { PortalRuntimeEnhancements } from "@/components/portal/portal-runtime-enhancements";
import { SignOutForm } from "@/components/sign-out-form";
import type { AppRole, PermissionSet } from "@/types/app";

export const dynamic = "force-dynamic";

async function PortalNotificationLinkSlot({ userId }: { userId: string }) {
  const { PortalNotificationLink } = await import("@/components/portal/portal-notification-link");
  return <PortalNotificationLink userId={userId} />;
}

async function PortalNavSlot({
  role,
  permissions,
  pathname
}: {
  role: AppRole;
  permissions?: PermissionSet;
  pathname: string;
}) {
  const { PortalNav } = await import("@/components/portal-nav");
  return <PortalNav role={role} permissions={permissions} pathname={pathname} />;
}

function PortalNavFallback() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {[0, 1, 2].map((group) => (
        <div key={group} className="rounded-lg border border-white/20 bg-white/5 p-2">
          <div className="h-4 w-28 rounded bg-white/15" />
          <div className="mt-2 grid gap-2">
            <div className="h-9 rounded bg-white/10" />
            <div className="h-9 rounded bg-white/10" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function PortalLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();
  const pathname = (await headers()).get("x-memory-lane-pathname") ?? "/";
  const showDevRoleSwitcher = isDevAuthBypassEnabled();
  const devAuthSection = showDevRoleSwitcher
    ? await (async () => {
        const { DevAuthBootstrapSection } = await import("@/components/auth/dev-auth-bootstrap-section");
        return <DevAuthBootstrapSection />;
      })()
    : null;

  return (
    <div className="portal-shell mx-auto grid min-h-screen w-full max-w-7xl gap-4 p-3 md:grid-cols-[320px_minmax(0,1fr)] md:p-4">
      <aside className="space-y-4 rounded-xl border border-white/20 bg-brand p-3 text-white md:sticky md:top-4 md:h-[calc(100vh-2rem)] md:min-w-0 md:overflow-y-auto">
        <div className="text-white">
          <Link href="/" className="mb-2 block">
            <Image
              src="/memory-lane-logo.png"
              alt="Memory Lane logo"
              width={260}
              height={156}
              className="h-auto w-full max-w-[280px]"
              priority
            />
          </Link>
          <p className="text-xs font-semibold text-white/90">Current User:</p>
          <p className="mt-1 text-sm font-semibold text-white">{profile.full_name}</p>
          {showDevRoleSwitcher ? (
            <p className="mt-1 text-[11px] text-white/80">
              dev-debug: role={profile.role} id={profile.id}
            </p>
          ) : null}
        </div>
        <Suspense fallback={<PortalNavFallback />}>
          <PortalNavSlot role={profile.role} permissions={profile.permissions} pathname={pathname} />
        </Suspense>
        <SignOutForm />
      </aside>
      <main className="space-y-4 pb-10">
        <div className="flex items-center justify-between rounded-lg border border-border bg-white px-3 py-2">
          <div>
            <p className="text-sm font-semibold text-brand">Memory Lane</p>
            <p className="text-xs text-muted">Operations Portal</p>
          </div>
          <div className="flex items-center gap-3">
            <Suspense
              fallback={
                <Link
                  href="/notifications"
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-brand hover:bg-slate-50"
                >
                  Notifications
                </Link>
              }
            >
              <PortalNotificationLinkSlot userId={profile.id} />
            </Suspense>
            <PortalRuntimeEnhancements />
          </div>
        </div>
        {devAuthSection}
        {children}
      </main>
    </div>
  );
}
