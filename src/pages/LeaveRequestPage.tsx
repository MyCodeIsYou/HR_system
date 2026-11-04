import { useEffect, useState, type CSSProperties } from "react"
import { useAuth } from "../auth/AuthContext.tsx"
import { Alert, Button, Field, Modal, Page } from "../components/ui.tsx"
import { cancelLeaveRequest, requestLeave } from "../lib/api.ts"
import { deductLabel, formatLeaveDays, humanError, seoulToday } from "../lib/format.ts"
import { supabase } from "../lib/supabase.ts"
import type { LeaveBalance, LeaveKind, LeaveRequest, LeaveType } from "../types.ts"

const weekdays = ["일", "월", "화", "수", "목", "금", "토"]

function balanceOf(rows: LeaveBalance[], type: LeaveType): number {
  return rows.find((row) => row.leave_type === type)?.balance_minutes ?? 0
}

function monthCells(year: number, month: number): Array<number | null> {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return [...Array<number | null>(first).fill(null), ...Array.from({ length: count }, (_, index) => index + 1)]
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function chipLabel(request: LeaveRequest): string {
  if (request.kind_name) return request.kind_name
  if (request.leave_type === "annual" && request.minutes === 240) return "반차"
  if (request.leave_type === "annual" && request.minutes === 120) return "반반"
  if (request.leave_type === "annual") return "연차"
  if (request.leave_type === "comp") return "보상"
  if (request.leave_type === "summer") return "여름"
  return "휴가"
}

type ChipTone = { bg: string; fg: string }

const namedTones: Record<string, ChipTone> = {
  휴가: { bg: "#ff8a32", fg: "#3a1608" },
  연차: { bg: "#ff8a32", fg: "#3a1608" },
  반차: { bg: "#8a5cff", fg: "#ffffff" },
  반반: { bg: "#c6ef6a", fg: "#142408" },
  반반차: { bg: "#c6ef6a", fg: "#142408" },
  경조사휴가: { bg: "#5fd0e6", fg: "#082028" },
  보상: { bg: "#6aa6ff", fg: "#061428" },
  보상휴가: { bg: "#6aa6ff", fg: "#061428" },
  여름: { bg: "#ffd15c", fg: "#3a2808" },
  여름휴가: { bg: "#ffd15c", fg: "#3a2808" },
}

const extraTones: ChipTone[] = [
  { bg: "#ff5d8f", fg: "#3a1020" },
  { bg: "#7cffb2", fg: "#082018" },
  { bg: "#ff9a6a", fg: "#3a1608" },
  { bg: "#d6a2ff", fg: "#1a0828" },
  { bg: "#9ad1ff", fg: "#061428" },
  { bg: "#f2f26a", fg: "#2a2808" },
]

function chipTone(request: LeaveRequest): ChipTone {
  const name = request.kind_name?.trim() || chipLabel(request)
  const known = namedTones[name]
  if (known) return known
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return extraTones[hash % extraTones.length]
}

export function LeaveRequestPage() {
  const { profile, organization } = useAuth()
  const registerMode = organization?.leave_entry_mode === "register"
  const today = seoulToday()
  const [year, setYear] = useState(Number(today.slice(0, 4)))
  const [month, setMonth] = useState(Number(today.slice(5, 7)))
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [balances, setBalances] = useState<LeaveBalance[]>([])
  const [kinds, setKinds] = useState<LeaveKind[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [kindId, setKindId] = useState("")
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function load() {
    if (!profile) throw new Error("프로필이 없습니다.")
    const [requestResult, balanceResult, kindResult] = await Promise.all([
      supabase
        .from("leave_requests")
        .select("id, user_id, leave_type, kind_id, kind_name, work_date, minutes, status, note, entry_mode")
        .eq("user_id", profile.id)
        .in("status", ["pending", "approved"]),
      supabase.from("leave_balance_sums").select("user_id, leave_type, balance_minutes").eq("user_id", profile.id),
      supabase
        .from("leave_kinds")
        .select("id, name, minutes, deduct_type, enabled, sort_order")
        .eq("enabled", true)
        .order("sort_order")
        .order("name"),
    ])
    if (requestResult.error) throw requestResult.error
    if (balanceResult.error) throw balanceResult.error
    if (kindResult.error) throw kindResult.error
    return {
      requests: (requestResult.data ?? []) as LeaveRequest[],
      balances: (balanceResult.data ?? []) as LeaveBalance[],
      kinds: (kindResult.data ?? []) as LeaveKind[],
    }
  }

  useEffect(() => {
    if (!profile) return
    let active = true
    void load()
      .then((data) => {
        if (!active) return
        setRequests(data.requests)
        setBalances(data.balances)
        setKinds(data.kinds)
        setKindId((current) => current || data.kinds[0]?.id || "")
      })
      .catch((caught: unknown) => {
        if (active) setError(humanError(caught))
      })
    return () => {
      active = false
    }
  }, [profile, year, month])

  function shiftMonth(delta: number) {
    const next = new Date(Date.UTC(year, month - 1 + delta, 1))
    setYear(next.getUTCFullYear())
    setMonth(next.getUTCMonth() + 1)
  }

  function openDay(day: number) {
    setSelected(dateKey(year, month, day))
    setKindId(kinds[0]?.id ?? "")
    setNote("")
    setError(null)
  }

  const selectedRequest = requests.find((request) => request.work_date === selected) ?? null
  const selectedKind = kinds.find((kind) => kind.id === kindId) ?? null
  const held = requests
    .filter((request) => request.status === "pending" && selectedKind?.deduct_type && request.leave_type === selectedKind.deduct_type)
    .reduce((sum, request) => sum + request.minutes, 0)
  const available = selectedKind?.deduct_type ? balanceOf(balances, selectedKind.deduct_type) - held : 0

  async function submit() {
    if (!selected) return
    setPending(true)
    setError(null)
    try {
      if (!selectedKind) return
      await requestLeave({ kindId: selectedKind.id, workDate: selected, note })
      setSelected(null)
      const data = await load()
      setRequests(data.requests)
      setBalances(data.balances)
      setKinds(data.kinds)
    } catch (caught) {
      setError(humanError(caught))
    } finally {
      setPending(false)
    }
  }

  async function cancel(id: string) {
    setPending(true)
    setError(null)
    try {
      await cancelLeaveRequest(id)
      setSelected(null)
      const data = await load()
      setRequests(data.requests)
      setBalances(data.balances)
      setKinds(data.kinds)
    } catch (caught) {
      setError(humanError(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <Page
      title="내 휴가"
      description={
        registerMode
          ? "날짜를 눌러 휴가를 등록합니다. 승인 없이 바로 남은 휴가에서 차감됩니다. 1일, 반차 0.5일, 반반차 0.25일입니다."
          : "날짜를 눌러 휴가를 신청합니다. 관리자가 승인한 뒤 차감됩니다. 대기 중인 신청도 남은 휴가에서 빼 둡니다."
      }
      action={
        <div className="flex items-center gap-2">
          <button type="button" className="ds-icon-button" aria-label="이전 달" onClick={() => shiftMonth(-1)}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M14 6 8 12l6 6" />
            </svg>
          </button>
          <p className="min-w-28 text-center text-sm font-semibold tabular-nums">
            {year}년 {month}월
          </p>
          <button type="button" className="ds-icon-button" aria-label="다음 달" onClick={() => shiftMonth(1)}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="m10 6 6 6-6 6" />
            </svg>
          </button>
        </div>
      }
    >
      {error && !selected ? (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      ) : null}
      <ul className="mb-4 grid max-w-3xl grid-cols-3 gap-2">
        {(
          [
            ["연차", "annual", "ds-tone-orange"],
            ["보상휴가", "comp", "ds-tone-sky"],
            ["여름휴가", "summer", "ds-tone-gold"],
          ] as const
        ).map(([label, type, tone]) => (
          <li key={type} className={`ds-card ${tone} px-2 py-2 text-center`}>
            <p className="text-xs font-semibold">{label}</p>
            <p className="mt-1 text-sm font-semibold tabular-nums">{formatLeaveDays(balanceOf(balances, type))}</p>
          </li>
        ))}
      </ul>
      <div className="ds-cal max-w-3xl">
        {weekdays.map((label, index) => (
          <div key={label} className={index === 0 ? "ds-cal-head is-sun" : "ds-cal-head"}>
            {label}
          </div>
        ))}
        {monthCells(year, month).map((day, index) => {
          if (!day) return <div key={`empty-${index}`} />
          const key = dateKey(year, month, day)
          const request = requests.find((item) => item.work_date === key)
          const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
          const tone = request ? chipTone(request) : null
          return (
            <button
              key={key}
              type="button"
              className={`ds-cal-day${key === today ? " is-today" : ""}${weekday === 0 ? " is-sun" : ""}${tone ? " is-marked" : ""}`}
              style={tone ? ({ "--leave": tone.bg } as CSSProperties) : undefined}
              aria-label={`${day}일${request ? ` ${chipLabel(request)}${request.status === "pending" ? " 대기" : ""}` : ""}`}
              onClick={() => openDay(day)}
            >
              <span className="ds-cal-num">{day}</span>
              {request && tone ? (
                <span
                  className={`ds-cal-chip${request.status === "pending" ? " is-pending" : ""}`}
                  style={{ background: tone.bg, color: tone.fg }}
                >
                  {chipLabel(request)}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      {selected ? (
        <Modal title={selected} onClose={() => setSelected(null)}>
          {error ? (
            <div className="mb-3">
              <Alert>{error}</Alert>
            </div>
          ) : null}
          {selectedRequest ? (
            <div className="grid gap-3 text-sm">
              <p>
                {chipLabel(selectedRequest)} {formatLeaveDays(selectedRequest.minutes)} ·{" "}
                {selectedRequest.status === "pending" ? "대기" : selectedRequest.entry_mode === "register" ? "등록" : "승인"}
              </p>
              {selectedRequest.note ? <p className="text-muted">{selectedRequest.note}</p> : null}
              {selectedRequest.status === "pending" || selectedRequest.entry_mode === "register" ? (
                <Button variant="danger" disabled={pending} onClick={() => void cancel(selectedRequest.id)}>
                  {pending ? "취소 중" : selectedRequest.entry_mode === "register" ? "등록 취소" : "신청 취소"}
                </Button>
              ) : (
                <p className="text-xs text-muted">승인된 휴가는 여기서 취소할 수 없습니다.</p>
              )}
            </div>
          ) : (
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault()
                void submit()
              }}
            >
              {kinds.length === 0 ? <p className="text-sm text-muted">신청할 수 있는 휴가가 없습니다.</p> : null}
              {kinds.length > 0 ? (
                <Field
                  compact
                  label="종류"
                  hint={
                    selectedKind?.deduct_type
                      ? `${deductLabel(selectedKind.deduct_type)} ${formatLeaveDays(selectedKind.minutes)} · ${registerMode ? "등록" : "신청"} 가능 ${formatLeaveDays(Math.max(available, 0))}`
                      : `${formatLeaveDays(selectedKind?.minutes ?? 0)} · 남은 휴가에서 빠지지 않습니다.`
                  }
                >
                  <select value={kindId} onChange={(event) => setKindId(event.target.value)}>
                    {kinds.map((kind) => (
                      <option key={kind.id} value={kind.id}>
                        {kind.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              <Field compact label="메모">
                <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="선택" />
              </Field>
              <Button type="submit" disabled={pending || !selectedKind}>
                {pending ? (registerMode ? "등록 중" : "신청 중") : registerMode ? "등록" : "신청"}
              </Button>
            </form>
          )}
        </Modal>
      ) : null}
    </Page>
  )
}
