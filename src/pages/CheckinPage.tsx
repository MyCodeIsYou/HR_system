import { useEffect, useState } from "react"
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom"
import { useAuth } from "../auth/AuthContext.tsx"
import { Button, FullScreen, Notice } from "../components/ui.tsx"
import { recordAttendance } from "../lib/api.ts"
import { eventLabel, formatTime, humanError, penaltyLines } from "../lib/format.ts"
import type { AttendanceResult } from "../types.ts"

const lockKey = "hr-nfc-lock"
const tokenKey = "hr-nfc-token"
const resultKey = "hr-nfc-result"
const errorKey = "hr-nfc-error"

const inflight = new Map<string, Promise<AttendanceResult>>()
let punchGeneration = 0

type PunchView =
  | { kind: "pending" }
  | { kind: "done"; result: AttendanceResult }
  | { kind: "error"; message: string }
  | { kind: "restored" }

function storageGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function storageSet(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    return
  }
}

function storageRemove(key: string) {
  try {
    sessionStorage.removeItem(key)
  } catch {
    return
  }
}

function readResult(): AttendanceResult | null {
  const raw = storageGet(resultKey)
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as AttendanceResult
    if (!value || typeof value !== "object" || !value.action || !value.occurred_at) return null
    return value
  } catch {
    return null
  }
}

function rememberSuccess(token: string, generation: number, value: AttendanceResult) {
  if (generation !== punchGeneration) return value
  storageSet(resultKey, JSON.stringify(value))
  storageRemove(errorKey)
  storageSet(tokenKey, token)
  return value
}

function rememberFailure(generation: number, caught: unknown): never {
  const message = humanError(caught)
  if (generation === punchGeneration) {
    storageSet(errorKey, message)
    storageRemove(resultKey)
  }
  throw new Error(message)
}

function openedFromHistory(): boolean {
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined
  const discarded = (document as Document & { wasDiscarded?: boolean }).wasDiscarded === true
  return nav?.type === "reload" || nav?.type === "back_forward" || discarded
}

function startPunch(token: string) {
  const generation = ++punchGeneration
  storageSet(lockKey, token)
  storageSet(tokenKey, token)
  storageRemove(resultKey)
  storageRemove(errorKey)
  const pending = recordAttendance(token).then(
    (value) => rememberSuccess(token, generation, value),
    (caught: unknown) => rememberFailure(generation, caught),
  )
  inflight.set(token, pending)
  void pending.catch(() => undefined)
  void pending.finally(() => {
    if (inflight.get(token) === pending) inflight.delete(token)
  })
}

function initialView(token: string | null): PunchView {
  const saved = readResult()
  if (saved) return { kind: "done", result: saved }
  const message = storageGet(errorKey)
  if (message) return { kind: "error", message }
  if (token && inflight.has(token)) return { kind: "pending" }
  return { kind: "restored" }
}

export function CheckinPage() {
  const { token } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { configured, ready, session, profile, profileError } = useAuth()
  const tap = (location.state as { tap?: number } | null)?.tap

  useEffect(() => {
    if (!ready || !session || !profile?.organization_id || !token) return
    const freshTap = typeof tap === "number"
    if (freshTap) storageRemove(lockKey)
    if (!freshTap && (openedFromHistory() || inflight.has(token) || storageGet(lockKey) === token)) {
      navigate("/c/result", { replace: true, state: { token } })
      return
    }
    startPunch(token)
    navigate("/c/result", { replace: true, state: { token } })
  }, [ready, session, profile?.organization_id, token, navigate, tap])

  if (!configured) return null
  if (!token) return <Navigate to="/" replace />
  if (!ready) return <FullScreen title="출퇴근을 확인하는 중" />
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(`/c/${token}`)}`} replace />
  if (profileError) return <FullScreen title="프로필을 불러오지 못했습니다">{profileError}</FullScreen>
  if (!profile) return <FullScreen title="프로필을 불러오는 중" />
  if (!profile.organization_id) return <Navigate to="/setup" replace />
  return <FullScreen title="기록하는 중" />
}

export function CheckinResultPage() {
  const location = useLocation()
  const { configured, ready, profile } = useAuth()
  const stateToken = (location.state as { token?: string } | null)?.token ?? null
  const token = stateToken ?? storageGet(tokenKey)
  const [view, setView] = useState<PunchView>(() => initialView(token))

  useEffect(() => {
    storageRemove(lockKey)
    if (!token) return
    const pending = inflight.get(token)
    if (!pending) return
    let active = true
    pending.then(
      (value) => {
        if (active) setView({ kind: "done", result: value })
      },
      (caught: unknown) => {
        if (active) setView({ kind: "error", message: humanError(caught) })
      },
    )
    return () => {
      active = false
    }
  }, [token])

  async function retry() {
    if (!token) return
    const generation = ++punchGeneration
    setView({ kind: "pending" })
    storageRemove(resultKey)
    storageRemove(errorKey)
    try {
      const value = await recordAttendance(token).then(
        (result) => rememberSuccess(token, generation, result),
        (caught: unknown) => rememberFailure(generation, caught),
      )
      setView({ kind: "done", result: value })
    } catch (caught: unknown) {
      setView({ kind: "error", message: humanError(caught) })
    }
  }

  if (!configured) return null
  if (!ready) return <FullScreen title="출퇴근을 확인하는 중" />

  return (
    <main className="grid min-h-svh place-items-center px-4 py-10">
      <div className="ds-card w-full max-w-md px-6 py-8 text-center">
        {profile?.name ? <p className="text-xs tracking-[0.18em] text-accent">{profile.name}</p> : null}
        {view.kind === "pending" ? <h1 className="mt-6 text-3xl font-semibold">기록하는 중</h1> : null}
        {view.kind === "error" ? (
          <>
            <h1 className="mt-6 text-2xl font-semibold">기록하지 못했습니다</h1>
            <p className="mt-3 text-sm leading-6 text-danger">{view.message}</p>
            {token ? (
              <Button className="mt-6" onClick={() => void retry()}>
                다시 기록
              </Button>
            ) : null}
          </>
        ) : null}
        {view.kind === "done" ? <Receipt result={view.result} /> : null}
        {view.kind === "restored" ? (
          <>
            <h1 className="mt-6 text-2xl font-semibold">이미 연 화면입니다</h1>
            <p className="mt-3 text-sm leading-6 text-muted">
              브라우저가 출퇴근 주소를 다시 열었습니다. 같은 기록은 한 번만 남기고, 이번에는 출근이나 퇴근을 추가하지 않았습니다.
            </p>
          </>
        ) : null}
        <Link to="/" className="mt-8 inline-block text-sm text-muted underline-offset-4 hover:underline">
          내 근태 보기
        </Link>
      </div>
    </main>
  )
}

function Receipt({ result }: { result: AttendanceResult }) {
  const lines = penaltyLines(result)
  return (
    <>
      <p className="mt-6 text-sm text-muted">{result.workplace_name}</p>
      <h1 className="mt-2 text-5xl font-semibold tracking-tight">{eventLabel(result.action)}</h1>
      <p className="mt-3 text-3xl tabular-nums">{formatTime(result.occurred_at)}</p>
      {lines.length > 0 ? (
        <ul className="mt-6 space-y-1 text-sm">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 text-sm text-ok">{result.action === "in" ? "정시 출근" : "야근 없음"}</p>
      )}
      {result.status === "debounced" ? (
        <p className="mt-4 text-xs leading-5 text-muted">잠시 전에 찍은 기록을 다시 보여 드립니다.</p>
      ) : null}
      {result.notice === "open_shift_left" ? (
        <div className="mt-4 text-left">
          <Notice>이전 근무의 퇴근이 없습니다. 오늘은 출근으로 남겼고, 이전 기록은 관리자 보정이 필요합니다.</Notice>
        </div>
      ) : null}
      <p className="mt-4 text-xs leading-5 text-muted">이 화면을 다시 열어도 출퇴근은 추가되지 않습니다. 다음 기록은 카드를 다시 찍을 때 남습니다.</p>
    </>
  )
}
