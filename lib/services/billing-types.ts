import type { ClosureRuleLike } from "@/lib/services/closure-rules";
import type { MemberHoldLike } from "@/lib/services/expected-attendance";
import type { ScheduleChangeRow } from "@/lib/services/schedule-changes-supabase";

export type BillingModuleRole = "admin" | "manager" | "director" | "coordinator";

export const BILLING_STATUS_OPTIONS = ["Unbilled", "Billed", "Excluded"] as const;
export const TRANSPORTATION_BILLING_STATUS_OPTIONS = ["BillNormally", "Waived", "IncludedInProgramRate"] as const;
export const BILLING_ADJUSTMENT_TYPE_OPTIONS = [
  "ExtraDay",
  "Credit",
  "Discount",
  "Refund",
  "ManualCharge",
  "ManualCredit",
  "PriorBalance",
  "Other"
] as const;
export const BILLING_BATCH_STATUS_OPTIONS = ["Draft", "Reviewed", "Finalized", "Exported", "Closed"] as const;
export const BILLING_INVOICE_STATUS_OPTIONS = ["Draft", "Finalized", "Sent", "Paid", "PartiallyPaid", "Void"] as const;
export const BILLING_EXPORT_TYPES = ["QuickBooksCSV", "InternalReviewCSV", "InvoiceSummaryCSV"] as const;
export const CENTER_CLOSURE_TYPE_OPTIONS = ["Holiday", "Weather", "Planned", "Emergency", "Other"] as const;
export const BILLING_MODE_OPTIONS = ["Membership", "Monthly", "Custom"] as const;
export const MONTHLY_BILLING_BASIS_OPTIONS = ["ScheduledMonthBehind", "ActualAttendanceMonthBehind"] as const;
export const BILLING_BATCH_TYPE_OPTIONS = ["Membership", "Monthly", "Mixed", "Custom"] as const;
export const BILLING_INVOICE_SOURCE_OPTIONS = ["BatchGenerated", "Custom"] as const;

export type DateRange = { start: string; end: string };

export type ActiveEffectiveDatedRow = {
  active: boolean;
  effective_start_date: string;
  effective_end_date: string | null;
};

export type MemberScopedActiveEffectiveDatedRow = ActiveEffectiveDatedRow & {
  member_id: string;
};

export type BillingSettingRow = {
  id: string;
  member_id: string;
  payor_id: string | null;
  use_center_default_billing_mode: boolean;
  billing_mode: "Membership" | "Monthly" | "Custom" | null;
  monthly_billing_basis: "ScheduledMonthBehind" | "ActualAttendanceMonthBehind";
  use_center_default_rate: boolean;
  custom_daily_rate: number | null;
  flat_monthly_rate: number | null;
  bill_extra_days: boolean;
  transportation_billing_status: "BillNormally" | "Waived" | "IncludedInProgramRate";
  bill_ancillary_arrears: boolean;
  active: boolean;
  effective_start_date: string;
  effective_end_date: string | null;
  billing_notes: string | null;
  created_at: string;
  updated_at: string;
  updated_by_user_id: string | null;
  updated_by_name: string | null;
};

export type CenterBillingSettingRow = {
  id: string;
  default_daily_rate: number;
  default_extra_day_rate: number | null;
  default_transport_one_way_rate: number;
  default_transport_round_trip_rate: number;
  billing_cutoff_day: number;
  default_billing_mode: "Membership" | "Monthly";
  effective_start_date: string;
  effective_end_date: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  updated_by_user_id: string | null;
  updated_by_name: string | null;
};

export type ScheduleTemplateRow = {
  id: string;
  member_id: string;
  effective_start_date: string;
  effective_end_date: string | null;
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  updated_by_user_id: string | null;
  updated_by_name: string | null;
};

export type AttendanceSettingWeekdays = {
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
};

export type BillingPreviewRow = {
  memberId: string;
  memberName: string;
  payorName: string;
  payorId: string | null;
  billingMode: (typeof BILLING_MODE_OPTIONS)[number];
  monthlyBillingBasis: (typeof MONTHLY_BILLING_BASIS_OPTIONS)[number] | null;
  invoiceMonth: string;
  basePeriodStart: string;
  basePeriodEnd: string;
  variableChargePeriodStart: string;
  variableChargePeriodEnd: string;
  billingMethod: string;
  baseProgramAmount: number;
  transportationAmount: number;
  ancillaryAmount: number;
  adjustmentAmount: number;
  totalAmount: number;
  baseProgramBilledDays: number;
  memberDailyRateSnapshot: number;
  transportationBillingStatusSnapshot: "BillNormally" | "Waived" | "IncludedInProgramRate";
  variableSourceRows: Array<{
    line_type: "Transportation" | "Ancillary" | "Adjustment" | "Credit";
    service_date: string | null;
    service_period_start: string;
    service_period_end: string;
    description: string;
    quantity: number;
    unit_rate: number;
    amount: number;
    source_table: "transportation_logs" | "ancillary_charge_logs" | "billing_adjustments";
    source_record_id: string;
  }>;
};

export type BillingBatchInvoiceRpcPayload = {
  id: string;
  member_id: string;
  payor_id: string | null;
  invoice_number: string;
  invoice_month: string;
  invoice_source: "BatchGenerated" | "Custom";
  invoice_status: "Draft" | "Finalized" | "Sent" | "Paid" | "PartiallyPaid" | "Void";
  export_status: string;
  billing_mode_snapshot: string;
  monthly_billing_basis_snapshot: string | null;
  transportation_billing_status_snapshot: string;
  billing_method_snapshot: string;
  base_period_start: string;
  base_period_end: string;
  variable_charge_period_start: string;
  variable_charge_period_end: string;
  invoice_date: string | null;
  due_date: string | null;
  base_program_billed_days: number;
  member_daily_rate_snapshot: number;
  base_program_amount: number;
  transportation_amount: number;
  ancillary_amount: number;
  adjustment_amount: number;
  total_amount: number;
  notes: string | null;
  created_by_user_id: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
};

export type BillingBatchInvoiceLineRpcPayload = {
  id: string;
  invoice_id: string;
  member_id: string;
  payor_id: string | null;
  service_date: string | null;
  service_period_start: string;
  service_period_end: string;
  line_type: "BaseProgram" | "Transportation" | "Ancillary" | "Adjustment" | "Credit" | "PriorBalance";
  description: string;
  quantity: number;
  unit_rate: number;
  amount: number;
  source_table: "attendance_records" | "transportation_logs" | "ancillary_charge_logs" | "billing_adjustments" | null;
  source_record_id: string | null;
  billing_status: "Billed";
  created_at: string;
  updated_at: string;
};

export type BillingBatchCoverageRpcPayload = {
  member_id: string;
  coverage_type: "BaseProgram" | "Transportation" | "Ancillary" | "Adjustment";
  coverage_start_date: string;
  coverage_end_date: string;
  source_invoice_id: string;
  source_invoice_line_id: string;
  source_table: string | null;
  source_record_id: string | null;
  created_at: string;
};

export type BillingBatchSourceUpdateRpcPayload = {
  source_table: "transportation_logs" | "ancillary_charge_logs" | "billing_adjustments";
  source_record_id: string;
  invoice_id: string;
  updated_at: string;
};

export type BillingBatchWritePlan = {
  batchId: string;
  batchPayload: {
    id: string;
    batch_type: (typeof BILLING_BATCH_TYPE_OPTIONS)[number];
    billing_month: string;
    run_date: string;
    batch_status: "Draft";
    invoice_count: number;
    total_amount: number;
    completion_date: null;
    next_due_date: string;
    generated_by_user_id: string;
    generated_by_name: string;
    created_at: string;
    updated_at: string;
  };
  invoicePayloads: BillingBatchInvoiceRpcPayload[];
  invoiceLinePayloads: BillingBatchInvoiceLineRpcPayload[];
  coveragePayloads: BillingBatchCoverageRpcPayload[];
  sourceUpdates: BillingBatchSourceUpdateRpcPayload[];
};

export type BillingExportRpcPayload = {
  id: string;
  billing_batch_id: string;
  export_type: (typeof BILLING_EXPORT_TYPES)[number];
  quickbooks_detail_level: "Summary" | "Detailed";
  file_name: string;
  file_data_url: string;
  generated_at: string;
  generated_by: string;
  status: "Generated";
  notes: null;
  created_at: string;
  updated_at: string;
};

export interface BatchGenerationInput {
  billingMonth: string;
  batchType?: (typeof BILLING_BATCH_TYPE_OPTIONS)[number];
  runDate?: string;
  runByUser: string;
  runByName: string;
}

export interface FinalizeBatchInput {
  billingBatchId: string;
  finalizedBy: string;
}

export interface ReopenBatchInput {
  billingBatchId: string;
  reopenedBy: string;
}

export interface CustomInvoiceManualLine {
  description: string;
  quantity: number;
  unitRate: number;
  amount?: number;
  lineType?: "BaseProgram" | "Transportation" | "Ancillary" | "Adjustment" | "Credit" | "PriorBalance";
}

export interface CreateCustomInvoiceInput {
  memberId: string;
  payorId?: string | null;
  invoiceDate?: string | null;
  dueDate?: string | null;
  periodStart: string;
  periodEnd: string;
  calculationMethod: "DailyRateTimesDates" | "FlatAmount" | "ManualLineItems";
  flatAmount?: number | null;
  useScheduleTemplate?: boolean;
  includeTransportation?: boolean;
  includeAncillary?: boolean;
  includeAdjustments?: boolean;
  manualIncludeDates?: string[];
  manualExcludeDates?: string[];
  manualLineItems?: CustomInvoiceManualLine[];
  notes?: string | null;
  runByUser: string;
  runByName: string;
}

export type BillingExpectedAttendanceInput = {
  dateOnly: string;
  schedule: ScheduleTemplateRow | null;
  attendanceSetting: AttendanceSettingWeekdays | null;
  holds: MemberHoldLike[];
  scheduleChanges: ScheduleChangeRow[];
};

export type BillingExpectedAttendanceCollectionInput = {
  startDate: string;
  endDate: string;
  schedule: ScheduleTemplateRow | null;
  attendanceSetting: AttendanceSettingWeekdays | null;
  holds: MemberHoldLike[];
  scheduleChanges: ScheduleChangeRow[];
};

export type ClosureRuleRow = ClosureRuleLike & { id: string };
