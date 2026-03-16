"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  AlarmClockCheck,
  BadgeAlert,
  BarChart3,
  Bath,
  Bell,
  BookUser,
  Building2,
  BusFront,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  Car,
  CircleDollarSign,
  CirclePause,
  ClipboardCheck,
  ClipboardList,
  ClipboardPlus,
  Clock3,
  CreditCard,
  ExternalLink,
  FileHeart,
  FilePenLine,
  FileSpreadsheet,
  FolderSearch,
  GitBranch,
  HandCoins,
  HeartPulse,
  ImageUp,
  LayoutDashboard,
  Lock,
  MonitorCog,
  NotebookText,
  PillBottle,
  ReceiptText,
  ShowerHead,
  TriangleAlert,
  TrendingUp,
  UserRoundCog,
  Users,
  WalletCards,
  type LucideIcon
} from "lucide-react";

import { navForRole } from "@/lib/permissions";
import type { AppNavItem, AppRole, NavGroup, PermissionSet } from "@/types/app";

const DEFAULT_GROUP_ORDER: NavGroup[] = ["Documentation", "Operations", "Reports", "Time & HR", "Sales Activities", "Health Unit"];
const ADMIN_GROUP_ORDER: NavGroup[] = ["Operations", "Reports", "Health Unit", "Time & HR", "Sales Activities", "Documentation"];
const NURSE_GROUP_ORDER: NavGroup[] = ["Health Unit", "Documentation", "Operations", "Reports", "Time & HR", "Sales Activities"];

const NAV_GROUP_ICONS: Record<NavGroup, LucideIcon> = {
  Documentation: NotebookText,
  Operations: LayoutDashboard,
  Reports: BarChart3,
  "Time & HR": AlarmClockCheck,
  "Sales Activities": GitBranch,
  "Health Unit": HeartPulse
};

const NAV_ICON_COMPONENTS: Record<AppNavItem["icon"], LucideIcon> = {
  Activity,
  AlarmClockCheck,
  BadgeAlert,
  BarChart3,
  Bath,
  Bell,
  BookUser,
  Building2,
  BusFront,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  Car,
  CircleDollarSign,
  CirclePause,
  ClipboardCheck,
  ClipboardList,
  ClipboardPlus,
  Clock3,
  CreditCard,
  FileHeart,
  FilePenLine,
  FileSpreadsheet,
  FolderSearch,
  GitBranch,
  HandCoins,
  HeartPulse,
  ImageUp,
  LayoutDashboard,
  Lock,
  MonitorCog,
  NotebookText,
  PillBottle,
  ReceiptText,
  ShowerHead,
  TriangleAlert,
  TrendingUp,
  UserRoundCog,
  Users,
  WalletCards
};

function getGroupOrder(role: AppRole): NavGroup[] {
  if (role === "admin") {
    return ADMIN_GROUP_ORDER;
  }
  if (role === "nurse") {
    return NURSE_GROUP_ORDER;
  }
  return DEFAULT_GROUP_ORDER;
}

function normalizeNavHref(href: string): string {
  const withoutHash = href.split("#", 1)[0] ?? href;
  const withoutQuery = withoutHash.split("?", 1)[0] ?? withoutHash;
  if (withoutQuery === "/") return "/";
  return withoutQuery.endsWith("/") ? withoutQuery.slice(0, -1) : withoutQuery;
}

function isActiveNavItem(item: AppNavItem, pathname: string): boolean {
  if (item.external || !item.href.startsWith("/")) {
    return false;
  }

  const normalizedItemHref = normalizeNavHref(item.href);
  const normalizedPathname = normalizeNavHref(pathname);

  return normalizedPathname === normalizedItemHref || normalizedPathname.startsWith(`${normalizedItemHref}/`);
}

function NavRow({ item, pathname }: { item: AppNavItem; pathname: string }) {
  const Icon = NAV_ICON_COMPONENTS[item.icon];
  const isActive = isActiveNavItem(item, pathname);
  const className = [
    "flex min-h-9 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[13px] font-medium leading-5 transition-colors",
    isActive ? "border-white/40 bg-white text-brand shadow-sm" : "border-white/20 bg-white/10 text-white hover:bg-[#8099B6]"
  ].join(" ");

  const content = (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-current" aria-hidden="true" />
        <span className="min-w-0 whitespace-normal break-words leading-tight">{item.label}</span>
      </span>
      {item.external ? <ExternalLink className="h-3.5 w-3.5 shrink-0 text-current opacity-80" aria-hidden="true" /> : null}
    </>
  );

  if (item.external) {
    return (
      <a href={item.href} target="_blank" rel="noopener noreferrer" className={className}>
        {content}
      </a>
    );
  }

  return (
    <Link href={item.href} className={className}>
      {content}
    </Link>
  );
}

export function PortalNav({ role, permissions }: { role: AppRole; permissions?: PermissionSet }) {
  const pathname = usePathname();
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
        const GroupIcon = NAV_GROUP_ICONS[group];
        const groupHasActiveItem = items.some((item) => isActiveNavItem(item, pathname));

        return (
          <details key={group} className="rounded-lg border border-white/20 bg-white/5" open={groupHasActiveItem || idx === 0}>
            <summary className="cursor-pointer list-none px-3 py-2 text-xs font-bold uppercase tracking-wide text-white/85 hover:bg-white/10">
              <span className="flex items-center gap-2">
                <GroupIcon className="h-4 w-4 shrink-0 text-current" aria-hidden="true" />
                <span>{group}</span>
              </span>
            </summary>
            <div className="grid gap-2 p-2">
              {items.map((item) => (
                <NavRow key={`${item.group}:${item.href}`} item={item} pathname={pathname} />
              ))}
            </div>
          </details>
        );
      })}
    </nav>
  );
}
