import type React from "react";

export default function PortalTemplate({ children }: { children: React.ReactNode }) {
  return (
    <div className="portal-theme space-y-4">
      <div className="rounded-xl border border-border bg-[#8099B6] px-4 py-2 text-white shadow-sm">
        <p className="text-sm font-semibold">Town Square Fort Mill</p>
      </div>
      {children}
    </div>
  );
}
