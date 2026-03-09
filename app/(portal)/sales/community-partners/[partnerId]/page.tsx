import { redirect } from "next/navigation";

export default async function LegacyCommunityPartnerDetailRedirect({ params }: { params: Promise<{ partnerId: string }> }) {
  const { partnerId } = await params;
  redirect(`/sales/community-partners/organizations/${partnerId}`);
}