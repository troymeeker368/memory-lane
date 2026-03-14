import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";

const entryLinks = [
  { label: "New Inquiry", href: "/sales/new-entries/new-inquiry" },
  { label: "Send Enrollment Packet", href: "/sales/new-entries/send-enrollment-packet" },
  { label: "Completed Enrollment Packets", href: "/sales/new-entries/completed-enrollment-packets" },
  { label: "Enrollment Signature Setup", href: "/sales/new-entries/enrollment-signature-setup" },
  { label: "Log Partner Activities", href: "/sales/new-entries/log-partner-activities" },
  { label: "New Community Partner", href: "/sales/new-entries/new-community-partner" },
  { label: "New Referral Source", href: "/sales/new-entries/new-referral-source" },
  { label: "Log Lead Activity", href: "/sales/new-entries/log-lead-activity" }
];

export default async function SalesNewEntriesPage() {
  await requireModuleAccess("sales");

  return (
    <Card>
      <CardTitle>New Entries</CardTitle>
      <div className="mt-3 divide-y divide-border rounded-lg border border-border bg-white">
        {entryLinks.map((item) => (
          <Link key={item.href} href={item.href} className="block px-4 py-3 text-base font-medium hover:bg-slate-50">
            {item.label}
          </Link>
        ))}
      </div>
    </Card>
  );
}
