export const SCHEDULE_CHANGE_TYPES = [
  "Scheduled Absence",
  "Makeup Day",
  "Day Swap",
  "Temporary Schedule Change",
  "Permanent Schedule Change"
] as const;

export type ScheduleChangeType = (typeof SCHEDULE_CHANGE_TYPES)[number];

export const SCHEDULE_CHANGE_STATUSES = ["active", "cancelled", "completed"] as const;
export type ScheduleChangeStatus = (typeof SCHEDULE_CHANGE_STATUSES)[number];

export const SCHEDULE_WEEKDAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;
export type ScheduleWeekdayKey = (typeof SCHEDULE_WEEKDAY_KEYS)[number];

export interface ScheduleChangeRow {
  id: string;
  member_id: string;
  change_type: ScheduleChangeType;
  effective_start_date: string;
  effective_end_date: string | null;
  original_days: ScheduleWeekdayKey[];
  new_days: ScheduleWeekdayKey[];
  suspend_base_schedule: boolean;
  reason: string;
  notes: string | null;
  entered_by: string;
  entered_by_user_id: string | null;
  status: ScheduleChangeStatus;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  closed_by: string | null;
  closed_by_user_id: string | null;
}
