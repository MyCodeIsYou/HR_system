import type { AttendanceResult, LatePolicy, LeaveType } from "../types.ts"

export function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/"
  return value
}

export function humanError(error: unknown): string {
  const message = error instanceof Error ? error.message : "요청을 처리하지 못했습니다."
  if (message.includes("foreign key") || message.includes("attendance_events")) {
    return "출퇴근 기록이 있는 사업장은 삭제할 수 없습니다."
  }
  if (message.includes("employee_number")) return "이미 사용 중인 사번입니다."
  if (message.includes("Invalid login credentials")) return "이메일 또는 비밀번호가 올바르지 않습니다."
  if (message.includes("User already registered")) return "이미 가입된 이메일입니다."
  if (message.includes("Password should be")) return "비밀번호는 6자 이상이어야 합니다."
  return message
}

export function oneName(value: { name: string } | { name: string }[] | null | undefined): string {
  if (!value) return "이름 없음"
  return Array.isArray(value) ? value[0]?.name ?? "이름 없음" : value.name
}

export function clockLabel(value: string): string {
  return value.slice(0, 5)
}

export function seoulToday(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

export function seoulDateTimeLocal(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00"
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`
}

export function seoulLocalToIso(local: string): string {
  return `${local}:00+09:00`
}

export function formatDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-")
  if (!year || !month || !day) return value
  return `${year}.${month}.${day}`
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso))
}

export function formatDateTime(iso: string): string {
  return `${formatDate(seoulToday(new Date(iso)))} ${formatTime(iso)}`
}

export function formatMinutes(total: number): string {
  const sign = total < 0 ? "-" : ""
  const abs = Math.abs(total)
  const days = Math.floor(abs / 480)
  const rest = abs % 480
  const hours = Math.floor(rest / 60)
  const minutes = rest % 60
  const parts: string[] = []
  if (days) parts.push(`${days}일`)
  if (hours) parts.push(`${hours}시간`)
  if (minutes || parts.length === 0) parts.push(`${minutes}분`)
  return sign + parts.join(" ")
}

export function formatWon(amount: number): string {
  return `${new Intl.NumberFormat("ko-KR").format(amount)}원`
}

export function daysToMinutes(days: number): number {
  return Math.round(days * 480)
}

export function leaveTypeLabel(type: LeaveType): string {
  if (type === "annual") return "연차"
  if (type === "comp") return "보상휴가"
  return "여름휴가"
}

export function deductLabel(type: LeaveType | null): string {
  if (!type) return "차감 없음"
  return leaveTypeLabel(type)
}

export function formatLeaveDays(minutes: number): string {
  return `${leaveDayValue(minutes)}일`
}

export function leaveDayValue(minutes: number): string {
  const days = Math.round((minutes / 480) * 100) / 100
  const sign = days < 0 ? "-" : ""
  const text = Math.abs(days).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")
  return `${sign}${text}`
}

export function parseLeaveDays(value: string): { minutes: number } | { error: string } {
  const days = Number(value)
  if (!Number.isFinite(days)) return { error: "일수는 숫자로 입력하세요." }
  const quarters = days * 4
  if (Math.abs(quarters - Math.round(quarters)) > 1e-6) {
    return { error: "연차는 1일, 반차는 0.5일, 반반차는 0.25일 단위로 입력하세요." }
  }
  return { minutes: Math.round(quarters) * 120 }
}

const policyLabel: Record<LatePolicy, string> = {
  fine: "벌금",
  annual_leave: "연차 차감",
  none: "제재 없음",
}

export function latePolicyLabel(policy: LatePolicy): string {
  return policyLabel[policy]
}

export function eventLabel(eventType: "in" | "out"): string {
  return eventType === "in" ? "출근" : "퇴근"
}

export function penaltyLines(result: AttendanceResult): string[] {
  const lines: string[] = []
  if (result.late_minutes > 0) {
    lines.push(`지각 ${result.late_minutes}분`)
    if (result.penalty_type === "fine") lines.push(`벌금 ${formatWon(result.fine_amount)}`)
    if (result.penalty_type === "annual_leave") lines.push(`연차 ${formatLeaveDays(result.leave_minutes_deducted)} 차감`)
    if (result.penalty_type === "none") lines.push("제재 없음")
  }
  if (result.overtime_started) lines.push("야근 시작")
  if (result.overtime_minutes > 0) {
    lines.push(`야근 ${formatMinutes(result.overtime_minutes)}`)
    lines.push(`보상휴가 ${formatLeaveDays(result.comp_leave_minutes_granted)}`)
  }
  return lines
}
