import { useEffect, useState } from "react"
import { useAuth } from "../auth/AuthContext.tsx"
import { Page } from "../components/ui.tsx"
import { eventLabel, formatDate, formatLeaveDays, formatTime, humanError, oneName, seoulToday } from "../lib/format.ts"
import { supabase } from "../lib/supabase.ts"
import type { AttendanceEvent, LatePenalty, LeaveBalance, LeaveType } from "../types.ts"

function balance(rows: LeaveBalance[], type: LeaveType): number {
  return rows.find((row) => row.leave_type === type)?.balance_minutes ?? 0
}

export function HomePage() {
  const { profile } = useAuth()
  const [events, setEvents] = useState<AttendanceEvent[]>([])
  const [penalties, setPenalties] = useState<LatePenalty[]>([])
  const [balances, setBalances] = useState<LeaveBalance[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!profile) return
    let active = true
    void Promise.all([
      supabase
        .from("attendance_events")
        .select("id, event_type, occurred_at, work_date, source, voided_at, workplaces(name)")
        .eq("user_id", profile.id)
        .order("occurred_at", { ascending: false })
        .limit(40),
      supabase
        .from("late_penalties")
        .select("id, work_date, late_minutes, penalty_type, fine_amount, leave_minutes_deducted, voided_at, workplaces(name)")
        .eq("user_id", profile.id)
        .is("voided_at", null)
        .order("work_date", { ascending: false })
        .limit(20),
      supabase.from("leave_balance_sums").select("user_id, leave_type, balance_minutes").eq("user_id", profile.id),
    ])
      .then(([eventResult, penaltyResult, balanceResult]) => {
        if (!active) return
        if (eventResult.error) throw eventResult.error
        if (penaltyResult.error) throw penaltyResult.error
        if (balanceResult.error) throw balanceResult.error
        setEvents((eventResult.data ?? []) as AttendanceEvent[])
        setPenalties((penaltyResult.data ?? []) as LatePenalty[])
        setBalances((balanceResult.data ?? []) as LeaveBalance[])
      })
      .catch((caught: unknown) => {
        if (active) setError(humanError(caught))
      })
    return () => {
      active = false
    }
  }, [profile])

  const today = seoulToday()
  const todayEvents = events.filter((event) => event.work_date === today && !event.voided_at)
  const latest = events.find((event) => !event.voided_at)

  return (
    <Page title="내 근태" description="오늘 출퇴근, 연차, 보상휴가, 여름휴가, 남은 휴가입니다.">
      {error ? <p className="mb-4 text-sm text-danger">{error}</p> : null}
      <div className="grid max-w-3xl grid-cols-3 gap-2 sm:grid-cols-5">
        <div className="ds-card px-3 py-2">
          <p className="text-xs text-muted">오늘</p>
          <p className="mt-1 text-sm font-semibold">
            {latest && !latest.voided_at && latest.event_type === "in" && latest.work_date === today
              ? `근무 중 · ${formatTime(latest.occurred_at)}`
              : todayEvents.some((event) => event.event_type === "out")
                ? "퇴근"
                : "출근 전"}
          </p>
        </div>
        <div className="ds-card px-3 py-2">
          <p className="text-xs text-muted">연차</p>
          <p className="mt-1 text-sm font-semibold tabular-nums">{formatLeaveDays(balance(balances, "annual"))}</p>
        </div>
        <div className="ds-card px-3 py-2">
          <p className="text-xs text-muted">보상휴가</p>
          <p className="mt-1 text-sm font-semibold tabular-nums">{formatLeaveDays(balance(balances, "comp"))}</p>
        </div>
        <div className="ds-card px-3 py-2">
          <p className="text-xs text-muted">여름휴가</p>
          <p className="mt-1 text-sm font-semibold tabular-nums">{formatLeaveDays(balance(balances, "summer"))}</p>
        </div>
        <div className="ds-card px-3 py-2">
          <p className="text-xs text-muted">남은 휴가</p>
          <p className="mt-1 text-sm font-semibold tabular-nums">
            {formatLeaveDays(balance(balances, "annual") + balance(balances, "comp") + balance(balances, "summer"))}
          </p>
        </div>
      </div>

      <h2 className="mt-5 mb-2 text-sm font-semibold">오늘 기록</h2>
      {todayEvents.length === 0 ? <p className="text-xs text-muted">오늘 출퇴근이 없습니다.</p> : null}
      {todayEvents.length > 0 ? (
        <div className="ds-table is-compact max-w-3xl">
          <table className="w-full text-left">
            <thead className="text-muted">
              <tr>
                <th className="font-medium">구분</th>
                <th className="font-medium">시각</th>
                <th className="font-medium">사업장</th>
              </tr>
            </thead>
            <tbody>
              {todayEvents.map((event) => (
                <tr key={event.id}>
                  <td>{eventLabel(event.event_type)}</td>
                  <td className="tabular-nums">{formatTime(event.occurred_at)}</td>
                  <td>{oneName(event.workplaces)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <h2 className="mt-5 mb-2 text-sm font-semibold">최근 출퇴근</h2>
      {events.length === 0 ? <p className="text-xs text-muted">기록이 없습니다.</p> : null}
      {events.length > 0 ? (
        <div className="ds-table is-compact max-w-3xl">
          <table className="w-full text-left">
            <thead className="text-muted">
              <tr>
                <th className="font-medium">날짜</th>
                <th className="font-medium">구분</th>
                <th className="font-medium">시각</th>
                <th className="font-medium">사업장</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className={event.voided_at ? "text-muted line-through" : undefined}>
                  <td>{formatDate(event.work_date)}</td>
                  <td>{eventLabel(event.event_type)}</td>
                  <td className="tabular-nums">{formatTime(event.occurred_at)}</td>
                  <td>{oneName(event.workplaces)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <h2 className="mt-5 mb-2 text-sm font-semibold">지각</h2>
      {penalties.length === 0 ? <p className="text-xs text-muted">지각 내역이 없습니다.</p> : null}
      {penalties.length > 0 ? (
        <div className="ds-table is-compact max-w-3xl">
          <table className="w-full text-left">
            <thead className="text-muted">
              <tr>
                <th className="font-medium">날짜</th>
                <th className="font-medium">사업장</th>
                <th className="font-medium">지각</th>
                <th className="font-medium">제재</th>
              </tr>
            </thead>
            <tbody>
              {penalties.map((penalty) => (
                <tr key={penalty.id}>
                  <td>{formatDate(penalty.work_date)}</td>
                  <td>{oneName(penalty.workplaces)}</td>
                  <td className="tabular-nums">{penalty.late_minutes}분</td>
                  <td>
                    {penalty.penalty_type === "fine" ? `벌금 ${penalty.fine_amount.toLocaleString("ko-KR")}원` : ""}
                    {penalty.penalty_type === "annual_leave" ? `연차 ${formatLeaveDays(penalty.leave_minutes_deducted)}` : ""}
                    {penalty.penalty_type === "none" ? "제재 없음" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Page>
  )
}
