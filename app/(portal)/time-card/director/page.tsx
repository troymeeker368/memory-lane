import Link from "next/link";

import { Card, CardTitle } from "@/components/ui/card";
import { requireRoles } from "@/lib/auth";
import { getDirectorPayrollExportWorkspace } from "@/lib/payroll/payroll-export";
import { getDirectorTimecardsWorkspace } from "@/lib/services/director-timecards";

import type { DirectorTabKey } from "@/app/(portal)/time-card/director/director-timecards-shared";

const TABS: Array<{ key: DirectorTabKey; label: string }> = [
  { key: "pending", label: "Pending Approvals" },
  { key: "daily", label: "Daily Timecards" },
  { key: "forgotten", label: "Forgotten Punch Requests" },
  { key: "pto", label: "PTO Management" },
  { key: "summary", label: "Pay Period Summary" },
  { key: "export", label: "Payroll Export" }
];

function firstString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function renderActiveTab(input: {
  activeTab: DirectorTabKey;
  workspace: Awaited<ReturnType<typeof getDirectorTimecardsWorkspace>>;
  payrollWorkspace: Awaited<ReturnType<typeof getDirectorPayrollExportWorkspace>> | null;
  pendingHref: string;
  forgottenHref: string;
  ptoHref: string;
  printHref: string;
  downloadHref: string;
  employeeId: string | null;
  overridePayPeriodStart: string | null;
}) {
  if (input.activeTab === "pending") {
    const { PendingTab } = await import("@/app/(portal)/time-card/director/pending-tab");
    return <PendingTab workspace={input.workspace} pendingHref={input.pendingHref} />;
  }
  if (input.activeTab === "daily") {
    const { DailyTab } = await import("@/app/(portal)/time-card/director/daily-tab");
    return <DailyTab workspace={input.workspace} />;
  }
  if (input.activeTab === "forgotten") {
    const { ForgottenTab } = await import("@/app/(portal)/time-card/director/forgotten-tab");
    return <ForgottenTab workspace={input.workspace} forgottenHref={input.forgottenHref} />;
  }
  if (input.activeTab === "pto") {
    const { PtoTab } = await import("@/app/(portal)/time-card/director/pto-tab");
    return <PtoTab workspace={input.workspace} ptoHref={input.ptoHref} employeeId={input.employeeId} />;
  }
  if (input.activeTab === "summary") {
    const { SummaryTab } = await import("@/app/(portal)/time-card/director/summary-tab");
    return <SummaryTab workspace={input.workspace} />;
  }

  const { ExportTab } = await import("@/app/(portal)/time-card/director/export-tab");
  if (!input.payrollWorkspace) {
    throw new Error("Payroll export workspace is required for export tab rendering.");
  }
  return (
    <ExportTab
      workspace={input.payrollWorkspace}
      printHref={input.printHref}
      downloadHref={input.downloadHref}
      employeeId={input.employeeId}
      overridePayPeriodStart={input.overridePayPeriodStart}
    />
  );
}

export default async function DirectorTimecardsPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRoles(["admin", "director", "manager"]);
  const query = await searchParams;
  const tab = (firstString(query.tab) ?? "pending") as DirectorTabKey;
  const activeTab = TABS.some((item) => item.key === tab) ? tab : "pending";
  const payPeriodId = firstString(query.payPeriodId) ?? null;
  const overridePayPeriodStart = firstString(query.overridePayPeriodStart) ?? null;
  const employeeId = firstString(query.employeeId) ?? null;
  const status = firstString(query.status) ?? "all";
  const exceptionOnly = firstString(query.exceptionOnly) === "1";
  const successMessage = firstString(query.success);
  const errorMessage = firstString(query.error);

  const workspacePromise = getDirectorTimecardsWorkspace({
    payPeriodId,
    employeeId,
    status,
    exceptionOnly
  });
  const payrollWorkspacePromise =
    activeTab === "export"
      ? getDirectorPayrollExportWorkspace({
          employeeId,
          overridePayPeriodStart
        })
      : Promise.resolve(null);
  const [workspace, payrollWorkspace] = await Promise.all([workspacePromise, payrollWorkspacePromise]);

  const buildTabHref = (tabKey: DirectorTabKey) => {
    const params = new URLSearchParams();
    params.set("tab", tabKey);
    params.set("payPeriodId", workspace.selectedPayPeriod.id);
    if (employeeId) params.set("employeeId", employeeId);
    if (overridePayPeriodStart) params.set("overridePayPeriodStart", overridePayPeriodStart);
    if (status && status !== "all") params.set("status", status);
    if (exceptionOnly) params.set("exceptionOnly", "1");
    return `/time-card/director?${params.toString()}`;
  };

  const payrollPeriodStart = payrollWorkspace?.payPeriod.startDate ?? overridePayPeriodStart;
  const payrollParams = new URLSearchParams();
  if (employeeId) payrollParams.set("employeeId", employeeId);
  if (payrollPeriodStart) payrollParams.set("overridePayPeriodStart", payrollPeriodStart);
  const payrollQuery = payrollParams.toString();
  const printHref = `/time-card/director/payroll-print${payrollQuery ? `?${payrollQuery}` : ""}`;
  const downloadHref = `/time-card/director/payroll-export${payrollQuery ? `?${payrollQuery}` : ""}`;

  const activeTabContent = await renderActiveTab({
    activeTab,
    workspace,
    payrollWorkspace,
    pendingHref: buildTabHref("pending"),
    forgottenHref: buildTabHref("forgotten"),
    ptoHref: buildTabHref("pto"),
    printHref,
    downloadHref,
    employeeId,
    overridePayPeriodStart: payrollPeriodStart ?? null
  });

  return (
    <div className="space-y-4">
      {successMessage ? (
        <Card className="border-emerald-200 bg-emerald-50">
          <p className="text-sm font-semibold text-emerald-700">{successMessage}</p>
        </Card>
      ) : null}
      {errorMessage ? (
        <Card className="border-rose-200 bg-rose-50">
          <p className="text-sm font-semibold text-rose-700">{errorMessage}</p>
        </Card>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Director Timecards</CardTitle>
            <p className="mt-1 text-sm text-muted">
              Review, correct, approve, manage PTO, and export payroll-ready details by pay period.
            </p>
          </div>
          <Link href="/time-card" className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-brand">
            Back to Time Clock
          </Link>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap gap-2">
          {TABS.map((item) => (
            <Link
              key={item.key}
              href={buildTabHref(item.key)}
              className={`rounded-lg border px-3 py-2 text-xs font-semibold ${activeTab === item.key ? "border-brand bg-brand text-white" : "border-border text-brand"}`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle>Filters</CardTitle>
        <form className="mt-3 grid gap-2 md:grid-cols-6" method="get">
          <input type="hidden" name="tab" value={activeTab} />
          <select name="payPeriodId" defaultValue={workspace.selectedPayPeriod.id} className="h-10 rounded-lg border border-border px-3 text-sm">
            {workspace.payPeriods.map((period) => (
              <option key={period.id} value={period.id}>
                {period.label} {period.is_closed ? "(Closed)" : ""}
              </option>
            ))}
          </select>
          <select name="employeeId" defaultValue={employeeId ?? ""} className="h-10 rounded-lg border border-border px-3 text-sm">
            <option value="">All employees</option>
            {workspace.availableEmployees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.name}
              </option>
            ))}
          </select>
          <select name="status" defaultValue={status} className="h-10 rounded-lg border border-border px-3 text-sm">
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="needs_review">Needs review</option>
            <option value="approved">Approved</option>
            <option value="corrected">Corrected</option>
          </select>
          <label className="flex items-center gap-2 rounded-lg border border-border px-3 text-sm">
            <input type="checkbox" name="exceptionOnly" value="1" defaultChecked={exceptionOnly} />
            Exceptions only
          </label>
          <button type="submit" className="h-10 rounded-lg bg-brand px-3 text-sm font-semibold text-white">
            Apply
          </button>
        </form>
      </Card>

      {activeTabContent}
    </div>
  );
}
