import { useEffect, useRef, useState } from "react"
import { useAuth } from "../auth/AuthContext.tsx"
import { Alert, Button, Field, Page } from "../components/ui.tsx"
import { cancelLeaveRequest, requestLeave } from "../lib/api.ts"
import { deductLabel, formatLeaveDays, humanError, seoulToday } from "../lib/format.ts"
import { supabase } from "../lib/supabase.ts"
import type { LeaveBalance, LeaveKind, LeaveRequest, LeaveType } from "../types.ts"

type CalendarLeave = LeaveRequest & { name: string }

const weekdays = ["일", "월", "화", "수", "목", "금", "토"]

const leaveTalk = [
  { text: "저는 휴가봇 이에요.", mood: "smile" },
  { text: "심심하시군요", mood: "flat" },
  { text: "일 안하세요?", mood: "ask" },
  { text: "그만해라 쫌!!!", mood: "mad" },
] as const

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

function LeaveBotEyes({ mood }: { mood: (typeof leaveTalk)[number]["mood"] | null }) {
  return (
    <svg className="ds-eyes" viewBox="0 0 68 28" width="48" height="20" aria-hidden="true">
      {mood === "smile" ? (
        <>
          <path d="M8 18c4-10 12-10 16 0" />
          <path d="M44 18c4-10 12-10 16 0" />
        </>
      ) : mood === "flat" ? (
        <>
          <path d="M8 14h16" />
          <path d="M44 14h16" />
        </>
      ) : mood === "ask" ? (
        <>
          <path d="M6 8c6-6 14-4 16 2" />
          <circle cx="16" cy="18" r="3.2" />
          <circle cx="50" cy="16" r="3.2" />
        </>
      ) : mood === "mad" ? (
        <>
          <path d="M8 6 26 16" />
          <path d="M60 6 42 16" />
          <path d="M10 22h12" />
          <path d="M46 22h12" />
        </>
      ) : (
        <>
          <path d="M8 5l14 9-14 9" />
          <path d="M60 5 46 14l14 9" />
        </>
      )}
    </svg>
  )
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

function statusLabel(request: LeaveRequest): string {
  if (request.status === "pending") return "대기"
  if (request.entry_mode === "register") return "등록"
  return "승인"
}

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
  const [requests, setRequests] = useState<CalendarLeave[]>([])
  const [balances, setBalances] = useState<LeaveBalance[]>([])
  const [kinds, setKinds] = useState<LeaveKind[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [kindId, setKindId] = useState("")
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [talk, setTalk] = useState<number | null>(null)
  const [bubble, setBubble] = useState<{ text: string; key: number } | null>(null)
  const bubbleTimer = useRef<number | null>(null)
  const dayPanelRef = useRef<HTMLDivElement>(null)
  const leaveLine = talk === null ? null : leaveTalk[talk]

  useEffect(() => {
    return () => {
      if (bubbleTimer.current !== null) window.clearTimeout(bubbleTimer.current)
    }
  }, [])

  function showBubble(text: string) {
    setBubble({ text, key: Date.now() })
    if (bubbleTimer.current !== null) window.clearTimeout(bubbleTimer.current)
    bubbleTimer.current = window.setTimeout(() => setBubble(null), 2200)
  }

  function pokeLeaveBot() {
    const next = talk === null ? 0 : (talk + 1) % leaveTalk.length
    setTalk(next)
    showBubble(leaveTalk[next].text)
  }

  async function load() {
    if (!profile) throw new Error("프로필이 없습니다.")
    const monthStart = dateKey(year, month, 1)
    const monthEnd = dateKey(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate())
    const [requestResult, balanceResult, kindResult] = await Promise.all([
      supabase.rpc("workplace_leaves", { p_from: monthStart, p_to: monthEnd }),
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
      requests: ((requestResult.data ?? []) as CalendarLeave[]).sort((a, b) => a.name.localeCompare(b.name, "ko") || a.id.localeCompare(b.id)),
      balances: (balanceResult.data ?? []) as LeaveBalance[],
      kinds: (kindResult.data ?? []) as LeaveKind[],
    }
  }

  useEffect(() => {
    if (!selected) return
    function onClick(event: MouseEvent) {
      const panel = dayPanelRef.current
      if (!panel || !(event.target instanceof Node) || panel.contains(event.target)) return
      setSelected(null)
    }
    document.addEventListener("click", onClick)
    return () => document.removeEventListener("click", onClick)
  }, [selected])

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
    setSelected(null)
  }

  function openDay(day: number) {
    const key = dateKey(year, month, day)
    setError(null)
    if (selected === key) {
      setSelected(null)
      return
    }
    setSelected(key)
    setKindId(kinds[0]?.id ?? "")
    setNote("")
  }

  const dayRequests = requests.filter((request) => request.work_date === selected)
  const myRequest = dayRequests.find((request) => request.user_id === profile?.id) ?? null
  const selectedKind = kinds.find((kind) => kind.id === kindId) ?? null
  const held = requests
    .filter((request) => request.user_id === profile?.id && request.status === "pending" && selectedKind?.deduct_type && request.leave_type === selectedKind.deduct_type)
    .reduce((sum, request) => sum + request.minutes, 0)
  const available = selectedKind?.deduct_type ? balanceOf(balances, selectedKind.deduct_type) - held : 0

  async function submit() {
    if (!selected) return
    setPending(true)
    setError(null)
    try {
      if (!selectedKind) return
      await requestLeave({ kindId: selectedKind.id, workDate: selected, note })
      setNote("")
      const data = await load()
      setRequests(data.requests)
      setBalances(data.balances)
      setKinds(data.kinds)
      setSelected(null)
      setTalk(0)
      showBubble("즐거운 휴가 되세요~")
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
      description="초록점이 본인의 휴가 입니다."
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
      <div className={`ds-leave-orbit${selected ? " is-flat" : ""}`}>
        <div className="ds-card ds-orbit-card is-ml">
          <p className="ds-orbit-label">연차</p>
          <p className="ds-orbit-pill is-orange">{formatLeaveDays(balanceOf(balances, "annual"))}</p>
        </div>
        <div className="ds-card ds-orbit-card is-bc">
          <p className="ds-orbit-label">여름휴가</p>
          <p className="ds-orbit-pill is-lime">{formatLeaveDays(balanceOf(balances, "summer"))}</p>
        </div>
        <div className="ds-card ds-orbit-card is-mr">
          <p className="ds-orbit-label">보상휴가</p>
          <p className="ds-orbit-pill is-violet">{formatLeaveDays(balanceOf(balances, "comp"))}</p>
        </div>
        <button
          type="button"
          className={`ds-face is-leave ds-orbit-face${leaveLine ? ` is-${leaveLine.mood}` : ""}`}
          aria-label="휴가봇"
          onClick={pokeLeaveBot}
        >
          <span className="ds-face-core">
            <LeaveBotEyes mood={leaveLine?.mood ?? null} />
          </span>
        </button>
        {bubble ? (
          <p key={bubble.key} className="ds-leave-bubble" role="status">
            {bubble.text}
          </p>
        ) : null}
      </div>
      <div className="max-w-3xl" ref={dayPanelRef}>
        <div className={`ds-cal${selected ? " is-compact" : ""}`}>
          {weekdays.map((label, index) => (
            <div key={label} className={index === 0 ? "ds-cal-head is-sun" : "ds-cal-head"}>
              {label}
            </div>
          ))}
          {monthCells(year, month).map((day, index) => {
            if (!day) return <div key={`empty-${index}`} />
            const key = dateKey(year, month, day)
            const dayItems = requests.filter((item) => item.work_date === key)
            const myItem = dayItems.find((item) => item.user_id === profile?.id) ?? null
            const otherItems = dayItems.filter((item) => item.user_id !== profile?.id)
            const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
            const names = dayItems.map((item) => `${item.user_id === profile?.id ? "나" : item.name} ${chipLabel(item)}${item.status === "pending" ? " 대기" : ""}`).join(", ")
            return (
              <button
                key={key}
                type="button"
                className={`ds-cal-day${key === today ? " is-today" : ""}${weekday === 0 ? " is-sun" : ""}${key === selected ? " is-selected" : ""}`}
                aria-pressed={key === selected}
                aria-label={`${day}일${names ? ` ${names}` : ""}`}
                onClick={() => openDay(day)}
              >
                <span className="ds-cal-num">
                  {day}
                  {myItem ? <span className={`ds-cal-dot${myItem.status === "pending" ? " is-pending" : ""}`} /> : null}
                </span>
                {otherItems.length > 0 ? (
                  <span className="ds-cal-lines">
                    {otherItems.map((item) => (
                      <span
                        key={item.id}
                        className={`ds-cal-line${item.status === "pending" ? " is-pending" : ""}`}
                        style={{ background: chipTone(item).bg }}
                      />
                    ))}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
        <section className={`ds-leave-day${selected ? " is-open" : ""}`}>
          <div className="ds-leave-day-inner">
            {selected ? (
              <div>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold">
                    {Number(selected.slice(5, 7))}월 {Number(selected.slice(8, 10))}일 {weekdays[new Date(Date.UTC(year, month - 1, Number(selected.slice(8, 10)))).getUTCDay()]}요일
                  </h2>
                  <button type="button" className="text-xs text-muted underline-offset-4 hover:underline" onClick={() => setSelected(null)}>
                    닫기
                  </button>
                </div>
                {error ? (
                  <div className="mt-3">
                    <Alert>{error}</Alert>
                  </div>
                ) : null}
                {dayRequests.length > 0 ? (
                  <ul className="ds-leave-list">
                    {dayRequests.map((request) => {
                      const mine = request.user_id === profile?.id
                      const canCancel = mine && (request.status === "pending" || request.entry_mode === "register")
                      return (
                        <li key={request.id} className="ds-leave-row">
                          <span
                            className={`ds-leave-swatch${mine ? " is-mine" : ""}${request.status === "pending" ? " is-pending" : ""}`}
                            style={mine ? undefined : { background: chipTone(request).bg }}
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">
                              {request.name}
                              {mine ? " · 나" : ""}
                            </span>
                            <span className="block truncate text-xs text-muted">
                              {chipLabel(request)} {formatLeaveDays(request.minutes)} · {statusLabel(request)}
                              {mine && request.note ? ` · ${request.note}` : ""}
                            </span>
                          </span>
                          {canCancel ? (
                            <Button variant="danger" disabled={pending} onClick={() => void cancel(request.id)}>
                              {pending ? "취소 중" : "취소"}
                            </Button>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-muted">이 날짜에 등록된 휴가가 없습니다.</p>
                )}
                {myRequest ? null : (
                  <form
                    className="mt-3 grid gap-3"
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
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </Page>
  )
}
