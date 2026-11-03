export type Role = "admin" | "employee"
export type LatePolicy = "fine" | "annual_leave" | "none"
export type FineMode = "flat" | "per_minute"
export type LeaveDeductionMode = "exact_minutes" | "per_occurrence"
export type EventType = "in" | "out"
export type LeaveType = "annual" | "comp"
export type AttendanceSource = "nfc" | "manual"

export type Profile = {
  id: string
  organization_id: string | null
  workplace_id: string | null
  name: string
  email: string | null
  role: Role
  employee_number: string | null
  hired_at: string | null
  created_at: string
}

export type Organization = {
  id: string
  name: string
}

export type Workplace = {
  id: string
  organization_id: string
  name: string
  address: string | null
  timezone: string
  work_start: string
  work_end: string
  late_grace_minutes: number
  late_policy: LatePolicy
  fine_mode: FineMode
  fine_amount: number
  leave_deduction_mode: LeaveDeductionMode
  leave_deduction_minutes: number
  overtime_start: string
  comp_leave_ratio_overtime_minutes: number
  comp_leave_ratio_leave_minutes: number
  created_at: string
  updated_at: string
}

export type AttendanceResult = {
  status: "recorded" | "debounced"
  action: EventType
  occurred_at: string
  work_date: string
  workplace_id: string
  workplace_name: string
  late_minutes: number
  penalty_type: LatePolicy | null
  fine_amount: number
  leave_minutes_deducted: number
  overtime_minutes: number
  comp_leave_minutes_granted: number
  overtime_started?: boolean
  event_id: string
  notice: "open_shift_left" | null
}

export type AttendanceEvent = {
  id: string
  organization_id: string
  workplace_id: string
  user_id: string
  event_type: EventType
  occurred_at: string
  work_date: string
  source: AttendanceSource
  pair_event_id: string | null
  summary: AttendanceResult
  voided_at: string | null
  created_at: string
  profiles?: { name: string } | { name: string }[] | null
  workplaces?: { name: string } | { name: string }[] | null
}

export type LatePenalty = {
  id: string
  user_id: string
  workplace_id: string
  work_date: string
  late_minutes: number
  penalty_type: LatePolicy
  fine_amount: number
  leave_minutes_deducted: number
  voided_at: string | null
  created_at: string
  profiles?: { name: string } | { name: string }[] | null
  workplaces?: { name: string } | { name: string }[] | null
}

export type LeaveLedgerEntry = {
  id: string
  user_id: string
  leave_type: LeaveType
  delta_minutes: number
  reason: string
  work_date: string | null
  created_at: string
  subject?: { name: string } | { name: string }[] | null
}

export type LeaveBalance = {
  user_id: string
  leave_type: LeaveType
  balance_minutes: number
}

export type Adjustment = {
  id: string
  action: "add_event" | "void_event"
  note: string
  created_at: string
  event_id: string | null
  actor?: { name: string } | { name: string }[] | null
  subject?: { name: string } | { name: string }[] | null
}

export const workplaceColumns =
  "id, organization_id, name, address, timezone, work_start, work_end, late_grace_minutes, late_policy, fine_mode, fine_amount, leave_deduction_mode, leave_deduction_minutes, overtime_start, comp_leave_ratio_overtime_minutes, comp_leave_ratio_leave_minutes, created_at, updated_at"
