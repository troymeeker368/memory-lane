import type React from "react";

import { Card } from "@/components/ui/card";

export function MobileList({ items }: { items: Array<{ id: string; title: string; fields: Array<{ label: string; value: React.ReactNode }> }> }) {
  return (
    <div className="grid gap-3 md:hidden">
      {items.map((item) => (
        <Card key={item.id}>
          <p className="text-sm font-semibold">{item.title}</p>
          <div className="mt-2 grid gap-1">
            {item.fields.map((f) => (
              <p key={`${item.id}-${f.label}`} className="text-xs text-muted">
                <span className="font-semibold text-fg">{f.label}: </span>
                {f.value}
              </p>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
