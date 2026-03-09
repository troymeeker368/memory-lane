import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireModuleAccess } from "@/lib/auth";

const communityLinks = [
  { label: "Community Partner Organizations", href: "/sales/community-partners/organizations" },
  { label: "Referral Sources", href: "/sales/community-partners/referral-sources" }
];

export default async function SalesCommunityPartnersPage() {
  await requireModuleAccess("sales");

  return (
    <Card>
      <CardTitle>Community Partners</CardTitle>
      <div className="mt-3 divide-y divide-border rounded-lg border border-border bg-white">
        {communityLinks.map((item) => (
          <Link key={item.href} href={item.href} className="block px-4 py-3 text-base font-medium hover:bg-slate-50">
            {item.label}
          </Link>
        ))}
      </div>
    </Card>
  );
}