import { Card, CardTitle } from "@/components/ui/card";
import { CLOSURE_RULE_OBSERVED_WEEKEND_OPTIONS } from "@/lib/services/closure-rules";
import {
  CENTER_CLOSURE_TYPE_OPTIONS,
  listCenterClosures,
  listClosureRules
} from "@/lib/services/billing-supabase";

import {
  deleteCenterClosureAction,
  ensureCenterClosuresAction,
  saveClosureRuleAction,
  saveCenterClosureAction
} from "@/app/(portal)/operations/payor/actions";

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export default async function CenterClosuresPage() {
  const [closures, rules] = await Promise.all([listCenterClosures(), listClosureRules()]);
  const ruleNameById = new Map(rules.map((row) => [row.id, row.name] as const));

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Center Closures / Holiday Calendar</CardTitle>
        <p className="mt-1 text-sm text-muted">
          Active closure rules automatically generate current and next year dates. Schedule billing excludes active closure dates by default unless Billable Override is checked.
        </p>
        <form action={ensureCenterClosuresAction} className="mt-3">
          <button type="submit" className="h-9 rounded-lg border border-border px-3 text-xs font-semibold text-brand">
            Regenerate Current + Next Year
          </button>
        </form>
      </Card>

      <Card>
        <CardTitle>Closure Rules</CardTitle>
        <table className="mt-3">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Month</th>
              <th>Rule</th>
              <th>Observed</th>
              <th>Active</th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-sm text-muted">No closure rules configured.</td>
              </tr>
            ) : (
              rules.map((rule) => (
                <tr key={rule.id}>
                  <td>{rule.name}</td>
                  <td>{rule.rule_type === "fixed" ? "Fixed Date" : "Nth Weekday"}</td>
                  <td>{rule.month}</td>
                  <td>
                    {rule.rule_type === "fixed"
                      ? `Day ${rule.day ?? "-"}`
                      : `${rule.occurrence ?? "-"} ${rule.weekday ?? "-"}`}
                  </td>
                  <td>
                    <form action={saveClosureRuleAction} className="flex items-center gap-2">
                      <input type="hidden" name="id" value={rule.id} />
                      <input type="hidden" name="name" value={rule.name} />
                      <input type="hidden" name="ruleType" value={rule.rule_type} />
                      <input type="hidden" name="month" value={rule.month} />
                      <input type="hidden" name="day" value={rule.day ?? ""} />
                      <input type="hidden" name="weekday" value={rule.weekday ?? ""} />
                      <input type="hidden" name="occurrence" value={rule.occurrence ?? ""} />
                      <select
                        name="observedWhenWeekend"
                        defaultValue={rule.observed_when_weekend}
                        className="h-8 rounded border border-border px-2 text-xs"
                      >
                        {CLOSURE_RULE_OBSERVED_WEEKEND_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                      <label className="flex items-center gap-1 text-xs">
                        <input name="active" type="checkbox" value="true" defaultChecked={rule.active} />
                        Active
                      </label>
                      <button type="submit" className="h-8 rounded border border-border px-2 text-xs font-semibold text-brand">
                        Save Rule
                      </button>
                    </form>
                  </td>
                  <td>{rule.active ? "Yes" : "No"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

      <Card>
        <CardTitle>Add Manual Closure</CardTitle>
        <form action={saveCenterClosureAction} className="mt-3 grid gap-2 md:grid-cols-6">
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">Closure Date</span>
            <input name="closureDate" type="date" defaultValue={todayDate()} className="h-10 w-full rounded-lg border border-border px-3" required />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">Reason</span>
            <input name="closureName" placeholder="Weather Closure" className="h-10 w-full rounded-lg border border-border px-3" required />
          </label>
          <label className="space-y-1 text-xs">
            <span className="font-semibold text-muted">Type</span>
            <select name="closureType" className="h-10 w-full rounded-lg border border-border px-3">
              {CENTER_CLOSURE_TYPE_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs md:col-span-2">
            <span className="font-semibold text-muted">Notes</span>
            <input name="notes" placeholder="Optional context" className="h-10 w-full rounded-lg border border-border px-3" />
          </label>
          <div className="flex items-end gap-4">
            <label className="flex items-center gap-2 text-xs font-semibold text-muted">
              <input name="active" type="checkbox" value="true" defaultChecked />
              Active
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold text-muted">
              <input name="billableOverride" type="checkbox" value="true" />
              Billable Override
            </label>
          </div>
          <div className="md:col-span-6">
            <button type="submit" className="h-10 rounded-lg bg-brand px-4 text-sm font-semibold text-white">
              Save Manual Closure
            </button>
          </div>
        </form>
      </Card>

      <Card className="table-wrap">
        <CardTitle>Configured Closure Dates</CardTitle>
        <table className="mt-3">
          <thead>
            <tr>
              <th>Date</th>
              <th>Reason</th>
              <th>Type</th>
              <th>Auto</th>
              <th>Rule</th>
              <th>Billable Override</th>
              <th>Active</th>
              <th>Notes</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {closures.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-sm text-muted">No closure dates configured.</td>
              </tr>
            ) : (
              closures.map((row) => (
                <tr key={row.id}>
                  <td>{row.closure_date}</td>
                  <td>{row.closure_name}</td>
                  <td>{row.closure_type}</td>
                  <td>{row.auto_generated ? "Yes" : "No"}</td>
                  <td>{row.closure_rule_id ? ruleNameById.get(row.closure_rule_id) ?? row.closure_rule_id : "-"}</td>
                  <td>{row.billable_override ? "Yes" : "No"}</td>
                  <td>{row.active ? "Yes" : "No"}</td>
                  <td>{row.notes ?? "-"}</td>
                  <td>
                    <div className="flex flex-wrap gap-2">
                      <form action={saveCenterClosureAction} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="id" value={row.id} />
                        <input type="hidden" name="closureDate" value={row.closure_date} />
                        <input type="hidden" name="closureName" value={row.closure_name} />
                        <input type="hidden" name="closureType" value={row.closure_type} />
                        <input type="hidden" name="notes" value={row.notes ?? ""} />
                        <label className="flex items-center gap-1 text-xs">
                          <input name="active" type="checkbox" value="true" defaultChecked={row.active} />
                          Active
                        </label>
                        <label className="flex items-center gap-1 text-xs">
                          <input name="billableOverride" type="checkbox" value="true" defaultChecked={row.billable_override} />
                          Override
                        </label>
                        <button type="submit" className="h-8 rounded border border-border px-2 text-xs font-semibold text-brand">
                          Save
                        </button>
                      </form>
                      <form action={deleteCenterClosureAction}>
                        <input type="hidden" name="id" value={row.id} />
                        <button type="submit" className="h-8 rounded border border-border px-2 text-xs font-semibold text-red-700">
                          Delete
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
