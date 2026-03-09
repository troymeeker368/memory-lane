import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { navForRole } from "@/lib/permissions";
import type { AppRole, PermissionSet, NavGroup } from "@/types/app";

const DEFAULT_GROUP_ORDER: NavGroup[] = ["Documentation", "Operations", "Reports", "Time & HR", "Sales Activities", "Health Unit"];
const ADMIN_GROUP_ORDER: NavGroup[] = ["Operations", "Reports", "Health Unit", "Time & HR", "Sales Activities", "Documentation"];
const NURSE_GROUP_ORDER: NavGroup[] = ["Health Unit", "Documentation", "Operations", "Reports", "Time & HR", "Sales Activities"];

function getGroupOrder(role: AppRole): NavGroup[] {
  if (role === "admin") {
    return ADMIN_GROUP_ORDER;
  }
  if (role === "nurse") {
    return NURSE_GROUP_ORDER;
  }
  return DEFAULT_GROUP_ORDER;
}

export function PortalNav({ role, permissions }: { role: AppRole; permissions?: PermissionSet }) {
  const nav = navForRole(role, permissions);
  const groupOrder = getGroupOrder(role);
  const grouped = nav.reduce<Record<string, typeof nav>>((acc, item) => {
    if (!acc[item.group]) {
      acc[item.group] = [];
    }
    acc[item.group].push(item);
    return acc;
  }, {});

  const visibleGroups = groupOrder.filter((group) => grouped[group]?.length);

  return (
    <nav className="space-y-2">
      {visibleGroups.map((group, idx) => {
        const items = grouped[group];
        return (
          <details key={group} className="rounded-lg border border-white/20 bg-white/5" open={idx === 0}>
            <summary className="cursor-pointer list-none px-3 py-2 text-xs font-bold uppercase tracking-wide text-white/85 hover:bg-white/10">
              {group}
            </summary>
            <div className="grid gap-2 p-2">
              {items.map((item) => {
                const commonClass = "rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm font-medium text-white hover:bg-[#8099B6]";

                if (item.external) {
                  return (
                    <a key={item.href} href={item.href} target="_blank" rel="noopener noreferrer" className={commonClass}>
                      <span className="inline-flex items-center gap-2">
                        {item.label}
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                    </a>
                  );
                }

                return (
                  <Link key={item.href} href={item.href} className={commonClass}>
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </details>
        );
      })}
    </nav>
  );
}
