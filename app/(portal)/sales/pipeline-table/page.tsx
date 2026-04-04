import { redirect } from "next/navigation";
import { salesRoutes } from "@/lib/routes";

export default function RedirectPage() {
  redirect(salesRoutes.pipelineLeadsTable);
}
