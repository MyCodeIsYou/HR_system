import { useEffect, useState } from "react"
import { useAuth } from "../auth/AuthContext.tsx"
import { Page } from "../components/ui.tsx"
import { eventLabel, formatDate, formatLeaveDays, formatTime, formatWon, humanError, oneName, seoulToday } from "../lib/format.ts"
import { supabase } from "../lib/supabase.ts"
import type { AttendanceEvent, LatePenalty, LeaveBalance, LeaveType } from "../types.ts"

function balance(rows: LeaveBalance[], type: LeaveType): number {
  return rows.find((row) => row.leave_type === type)?.balance_minutes ?? 0
}

const SEGMENT_MASK: Record<string, string> = {
  "0": "1111110",
  "1": "0110000",
  "2": "1101101",
  "3": "1111001",
  "4": "0110011",
  "5": "1011011",
  "6": "1011111",
  "7": "1110000",
  "8": "1111111",
  "9": "1111011",
}

const DIGIT_W = 22
const DIGIT_H = 40
const THICK = 5.4
const DIGIT_X = [0, 26, 58, 84]

function horizontalSegment(x: number, y: number, width: number, height: number) {
  const tip = height * 0.7
  const mid = y + height / 2
  return `M${x + tip} ${y}H${x + width - tip}L${x + width} ${mid}L${x + width - tip} ${y + height}H${x + tip}L${x} ${mid}Z`
}

function verticalSegment(x: number, y: number, width: number, height: number) {
  const tip = width * 0.7
  const mid = x + width / 2
  return `M${mid} ${y}L${x + width} ${y + tip}V${y + height - tip}L${mid} ${y + height}L${x} ${y + height - tip}V${y + tip}Z`
}

function digitPaths(x: number) {
  const inner = DIGIT_W - THICK * 1.35
  const left = x + THICK * 0.68
  const upperH = DIGIT_H / 2 - THICK * 0.85
  const lowerY = DIGIT_H / 2 + THICK * 0.22
  return [
    horizontalSegment(left, 0, inner, THICK),
    verticalSegment(x + DIGIT_W - THICK, THICK * 0.55, THICK, upperH),
    verticalSegment(x + DIGIT_W - THICK, lowerY, THICK, upperH),
    horizontalSegment(left, DIGIT_H - THICK, inner, THICK),
    verticalSegment(x, lowerY, THICK, upperH),
    verticalSegment(x, THICK * 0.55, THICK, upperH),
    horizontalSegment(left, (DIGIT_H - THICK) / 2, inner, THICK),
  ]
}

function SegmentTime({ digits }: { digits: string }) {
  return (
    <svg className="ds-seg" viewBox={`0 0 ${DIGIT_X[3] + DIGIT_W} ${DIGIT_H}`} aria-hidden="true">
      {digits.split("").map((digit, index) =>
        digitPaths(DIGIT_X[index] ?? 0).map((path, segment) => (
          <path
            key={`${digit}-${index}-${segment}`}
            className={SEGMENT_MASK[digit]?.[segment] === "1" ? "ds-seg-on" : "ds-seg-off"}
            d={path}
          />
        )),
      )}
      <rect className="ds-seg-on" x="51.4" y="11.2" width="3.2" height="3.2" rx="0.7" />
      <rect className="ds-seg-on" x="51.4" y="25.6" width="3.2" height="3.2" rx="0.7" />
    </svg>
  )
}

function seoulFace(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now)
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ""
  const hour = pick("hour").padStart(2, "0").slice(-2)
  const minute = pick("minute").padStart(2, "0").slice(-2)
  const weekday = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", weekday: "narrow" }).format(now)
  return {
    digits: `${hour}${minute}`,
    label: `${hour}:${minute}`,
    date: `${pick("year")}. ${pick("month")}. ${pick("day")} ${weekday}`,
  }
}

function SeoulClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const face = seoulFace(now)
  return (
    <time className="ds-clock" dateTime={now.toISOString()} aria-label={`${face.label} ${face.date}`}>
      <span className="ds-clock-time">
        <SegmentTime digits={face.digits} />
      </span>
      <span className="ds-clock-date">{face.date}</span>
    </time>
  )
}

export function HomePage() {
  const { profile } = useAuth()
  const [events, setEvents] = useState<AttendanceEvent[]>([])
  const [penalties, setPenalties] = useState<LatePenalty[]>([])
  const [fineTotal, setFineTotal] = useState(0)
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
      supabase
        .from("late_penalties")
        .select("fine_amount")
        .eq("user_id", profile.id)
        .eq("penalty_type", "fine")
        .is("voided_at", null),
      supabase.from("leave_balance_sums").select("user_id, leave_type, balance_minutes").eq("user_id", profile.id),
    ])
      .then(([eventResult, penaltyResult, fineResult, balanceResult]) => {
        if (!active) return
        if (eventResult.error) throw eventResult.error
        if (penaltyResult.error) throw penaltyResult.error
        if (fineResult.error) throw fineResult.error
        if (balanceResult.error) throw balanceResult.error
        setEvents((eventResult.data ?? []) as AttendanceEvent[])
        setPenalties((penaltyResult.data ?? []) as LatePenalty[])
        const fines = (fineResult.data ?? []) as { fine_amount: number }[]
        setFineTotal(fines.reduce((sum, row) => sum + row.fine_amount, 0))
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
  const working = Boolean(latest && latest.event_type === "in" && latest.work_date === today)
  const left = todayEvents.some((event) => event.event_type === "out")
  const mood = working ? "in" : left ? "out" : "idle"
  const moodText = working && latest ? `근무 중 · ${formatTime(latest.occurred_at)}` : left ? "퇴근" : "출근 전"
  const greeting = working || !left ? "오늘도 파이팅!" : "오늘도 수고하셨습니다."

  return (
    <Page title={greeting} menuTitle action={<SeoulClock />}>
      {error ? <p className="mb-4 text-sm text-danger">{error}</p> : null}
      <div className="ds-orbit">
        <div className="ds-card ds-orbit-card is-tl">
          <p className="ds-orbit-label">오늘</p>
          <p className="ds-orbit-pill is-teal">{working ? "근무 중" : left ? "퇴근" : "출근 전"}</p>
        </div>
        <div className="ds-card ds-orbit-card is-tr">
          <p className="ds-orbit-label">연차</p>
          <p className="ds-orbit-pill is-orange">{formatLeaveDays(balance(balances, "annual"))}</p>
        </div>
        <div className="ds-card ds-orbit-card is-ml">
          <p className="ds-orbit-label">보상휴가</p>
          <p className="ds-orbit-pill is-violet">{formatLeaveDays(balance(balances, "comp"))}</p>
        </div>
        <div className={`ds-face is-${mood} ds-orbit-face`} aria-hidden="true">
          <span className="ds-face-core">
            <svg className="ds-eyes" viewBox="0 0 68 28" width="48" height="20">
              <g className="ds-eyes-open">
                <path d="M8 5l14 9-14 9" />
                <path d="M60 5 46 14l14 9" />
              </g>
              <g className="ds-eyes-shut">
                <path d="M8 14h16" />
                <path d="M44 14h16" />
              </g>
            </svg>
          </span>
        </div>
        <div className="ds-card ds-orbit-card is-mr">
          <p className="ds-orbit-label">여름휴가</p>
          <p className="ds-orbit-pill is-lime">{formatLeaveDays(balance(balances, "summer"))}</p>
        </div>
        <div className="ds-card ds-orbit-card is-bl">
          <p className="ds-orbit-label">남은 휴가</p>
          <p className="ds-orbit-pill is-coral">
            {formatLeaveDays(balance(balances, "annual") + balance(balances, "comp") + balance(balances, "summer"))}
          </p>
        </div>
        <div className="ds-card ds-orbit-card is-br">
          <p className="ds-orbit-label">벌금</p>
          <p className="ds-orbit-pill is-rose">{formatWon(fineTotal)}</p>
        </div>
        <p className="ds-orbit-caption">
          <span className="font-semibold">{profile?.name}</span>
          <span className="text-muted"> · {moodText}</span>
        </p>
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
              {events.slice(0, 4).map((event) => (
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
