import { FunctionsHttpError } from "@supabase/supabase-js"
import type { AttendanceResult, LeaveType } from "../types.ts"
import { humanError } from "./format.ts"
import { supabase } from "./supabase.ts"

function asResult(value: unknown): AttendanceResult {
  if (!value || typeof value !== "object") throw new Error("출퇴근 결과를 읽지 못했습니다.")
  return value as AttendanceResult
}

export async function readFunctionError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const payload = (await error.context.json()) as { error?: string }
      if (payload.error) return payload.error
    } catch {
      return "초대에 실패했습니다. invite-member 함수 배포를 확인해 주세요."
    }
  }
  return humanError(error)
}

export async function organizationExists(): Promise<boolean> {
  const { data, error } = await supabase.rpc("organization_exists")
  if (error) throw new Error(error.message)
  return Boolean(data)
}

export async function bootstrapOrganization(name: string): Promise<void> {
  const { error } = await supabase.rpc("bootstrap_organization", { p_name: name })
  if (error) throw new Error(error.message)
}

export async function recordAttendance(token: string): Promise<AttendanceResult> {
  const { data, error } = await supabase.rpc("record_attendance", { p_token: token })
  if (error) throw new Error(error.message)
  return asResult(data)
}

export async function workplaceToken(workplaceId: string): Promise<string> {
  const { data, error } = await supabase.rpc("workplace_nfc_token", { p_workplace_id: workplaceId })
  if (error) throw new Error(error.message)
  return String(data)
}

export async function rotateWorkplaceToken(workplaceId: string): Promise<string> {
  const { data, error } = await supabase.rpc("rotate_nfc_token", { p_workplace_id: workplaceId })
  if (error) throw new Error(error.message)
  return String(data)
}

export async function addAttendanceEvent(input: {
  userId: string
  workplaceId: string
  eventType: "in" | "out"
  occurredAt: string
  note: string
}): Promise<AttendanceResult> {
  const { data, error } = await supabase.rpc("admin_add_attendance_event", {
    p_user_id: input.userId,
    p_workplace_id: input.workplaceId,
    p_event_type: input.eventType,
    p_occurred_at: input.occurredAt,
    p_note: input.note,
  })
  if (error) throw new Error(error.message)
  return asResult(data)
}

export async function voidAttendanceEvent(eventId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc("admin_void_attendance_event", {
    p_event_id: eventId,
    p_note: note,
  })
  if (error) throw new Error(error.message)
}

export async function adjustLeave(input: {
  userId: string
  leaveType: LeaveType
  deltaMinutes: number
  reason: string
}): Promise<void> {
  const { error } = await supabase.rpc("admin_adjust_leave", {
    p_user_id: input.userId,
    p_leave_type: input.leaveType,
    p_delta_minutes: input.deltaMinutes,
    p_reason: input.reason,
  })
  if (error) throw new Error(error.message)
}

export async function inviteMember(body: {
  email: string
  name: string
  role: "admin" | "employee"
  workplace_id: string | null
  job_title: string | null
  employee_number: string | null
  hired_at: string | null
  initial_annual_days: number
}): Promise<void> {
  const { data, error } = await supabase.functions.invoke("invite-member", { body })
  if (error) throw new Error(await readFunctionError(error))
  if (data && typeof data === "object" && "error" in data && data.error) {
    throw new Error(String(data.error))
  }
}
