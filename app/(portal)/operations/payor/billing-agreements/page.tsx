import { redirect } from "next/navigation";

export default function BillingAgreementsRedirectPage() {
  redirect("/operations/payor/settings");
}
