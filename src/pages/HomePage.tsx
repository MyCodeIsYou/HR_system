import { useEffect, useState } from "react"
import { useAuth } from "../auth/AuthContext.tsx"
import { Card, Empty, Page } from "../components/ui.tsx"
import { eventLabel, formatDate, formatMinutes, formatTime, humanError, oneName, seoulToday } from "../lib/format.ts"
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
    <Page title="내 근태" description="오늘 출퇴근, 연차, 보상휴가, 지각 내역입니다.">
      {error ? <p className="mb-4 text-sm text-danger">{error}</p> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-muted">오늘</p>
          <p className="mt-2 text-xl font-semibold">
            {latest && !latest.voided_at && latest.event_type === "in" && latest.work_date === today
              ? `근무 중 · ${formatTime(latest.occurred_at)} 출근`
              : todayEvents.some((event) => event.event_type === "out")
                ? "퇴근"
                : "출근 전"}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted">연차</p>
          <p className="mt-2 text-xl font-semibold tabular-nums">{formatMinutes(balance(balances, "annual"))}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">보상휴가</p>
          <p className="mt-2 text-xl font-semibold tabular-nums">{formatMinutes(balance(balances, "comp"))}</p>
        </Card>
      </div>

      <h2 className="mt-8 mb-3 text-lg font-semibold">오늘 기록</h2>
      {todayEvents.length === 0 ? <Empty>오늘 출퇴근이 없습니다.</Empty> : null}
      <div className="space-y-2">
        {todayEvents.map((event) => (
          <Card key={event.id} className="flex items-center justify-between">
            <div>
              <p className="font-medium">{eventLabel(event.event_type)}</p>
              <p className="text-sm text-muted">{oneName(event.workplaces)}</p>
            </div>
            <p className="tabular-nums">{formatTime(event.occurred_at)}</p>
          </Card>
        ))}
      </div>

      <h2 className="mt-8 mb-3 text-lg font-semibold">최근 출퇴근</h2>
      {events.length === 0 ? <Empty>기록이 없습니다.</Empty> : null}
      <div className="ds-table">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <thead className="text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">날짜</th>
              <th className="px-4 py-3 font-medium">구분</th>
              <th className="px-4 py-3 font-medium">시각</th>
              <th className="px-4 py-3 font-medium">사업장</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className={event.voided_at ? "text-muted line-through" : undefined}>
                <td className="px-4 py-3">{formatDate(event.work_date)}</td>
                <td className="px-4 py-3">{eventLabel(event.event_type)}</td>
                <td className="px-4 py-3 tabular-nums">{formatTime(event.occurred_at)}</td>
                <td className="px-4 py-3">{oneName(event.workplaces)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-8 mb-3 text-lg font-semibold">지각</h2>
      {penalties.length === 0 ? <Empty>지각 내역이 없습니다.</Empty> : null}
      <div className="space-y-2">
        {penalties.map((penalty) => (
          <Card key={penalty.id} className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium">{formatDate(penalty.work_date)}</p>
              <p className="text-sm text-muted">{oneName(penalty.workplaces)}</p>
            </div>
            <p className="text-sm">
              {penalty.late_minutes}분
              {penalty.penalty_type === "fine" ? ` · 벌금 ${penalty.fine_amount.toLocaleString("ko-KR")}원` : ""}
              {penalty.penalty_type === "annual_leave" ? ` · 연차 ${formatMinutes(penalty.leave_minutes_deducted)}` : ""}
              {penalty.penalty_type === "none" ? " · 제재 없음" : ""}
            </p>
          </Card>
        ))}
      </div>
    </Page>
  )
}
