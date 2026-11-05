export type Role = "admin" | "employee"
export type LatePolicy = "fine" | "annual_leave" | "none"
export type FineMode = "flat" | "per_minute" | "step"
export type LeaveDeductionMode = "exact_minutes" | "per_occurrence"
export type EventType = "in" | "out"
export type LeaveType = "annual" | "comp" | "summer"
export type AttendanceSource = "nfc" | "manual" | "auto"
export type UiTheme = "night" | "soft"

export type Profile = {
  id: string
  organization_id: string | null
  workplace_id: string | null
  name: string
  email: string | null
  role: Role
  job_title: string | null
  employee_number: string | null
  hired_at: string | null
  ui_theme: UiTheme
  created_at: string
}

export type LeaveEntryMode = "request" | "register"

export type Organization = {
  id: string
  name: string
  leave_entry_mode: LeaveEntryMode
  leave_digest_emails: string[]
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
  fine_initial_minutes: number
  fine_initial_amount: number
  fine_step_minutes: number
  fine_step_amount: number
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
  leave_start_shift_minutes?: number
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

export type LeaveRequestStatus = "pending" | "approved" | "rejected" | "cancelled"

export type LeaveKind = {
  id: string
  name: string
  minutes: number
  deduct_type: LeaveType | null
  enabled: boolean
  sort_order: number
}

export type LeaveRequest = {
  id: string
  user_id: string
  leave_type: LeaveType | null
  kind_id: string | null
  kind_name: string | null
  work_date: string
  minutes: number
  status: LeaveRequestStatus
  entry_mode: LeaveEntryMode
  note: string
  subject?: { name: string } | { name: string }[] | null
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

export type SupportKind = "correction" | "inquiry"
export type SupportStatus = "open" | "answered" | "closed"

export type SupportTicket = {
  id: string
  kind: SupportKind
  title: string
  body: string
  status: SupportStatus
  reply: string
  masked_name: string
  mine: boolean
  created_at: string
  updated_at: string
  replied_at: string | null
}

export type SupportTicketPage = {
  total: number
  page: number
  size: number
  items: SupportTicket[]
}

export const workplaceColumns =
  "id, organization_id, name, address, timezone, work_start, work_end, late_grace_minutes, late_policy, fine_mode, fine_amount, fine_initial_minutes, fine_initial_amount, fine_step_minutes, fine_step_amount, leave_deduction_mode, leave_deduction_minutes, overtime_start, comp_leave_ratio_overtime_minutes, comp_leave_ratio_leave_minutes, created_at, updated_at"
