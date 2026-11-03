import { useEffect, useState } from "react"
import { Link, Navigate, useParams } from "react-router-dom"
import { useAuth } from "../auth/AuthContext.tsx"
import { Button, FullScreen, Notice } from "../components/ui.tsx"
import { recordAttendance } from "../lib/api.ts"
import { eventLabel, formatTime, humanError, penaltyLines } from "../lib/format.ts"
import type { AttendanceResult } from "../types.ts"

export function CheckinPage() {
  const { token } = useParams()
  const { configured, ready, session, profile, profileError } = useAuth()
  const [result, setResult] = useState<AttendanceResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!ready || !session || !profile?.organization_id || !token) return
    let active = true
    setError(null)
    setResult(null)
    void recordAttendance(token)
      .then((value) => {
        if (active) setResult(value)
      })
      .catch((caught: unknown) => {
        if (active) setError(humanError(caught))
      })
    return () => {
      active = false
    }
  }, [ready, session, profile?.organization_id, token, attempt])

  if (!configured) return null
  if (!token) return <Navigate to="/" replace />
  if (!ready) return <FullScreen title="출퇴근을 확인하는 중" />
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(`/c/${token}`)}`} replace />
  if (profileError) return <FullScreen title="프로필을 불러오지 못했습니다">{profileError}</FullScreen>
  if (!profile) return <FullScreen title="프로필을 불러오는 중" />
  if (!profile.organization_id) return <Navigate to="/setup" replace />

  const lines = result ? penaltyLines(result) : []

  return (
    <main className="grid min-h-svh place-items-center px-4 py-10">
      <div className="ds-card w-full max-w-md px-6 py-8 text-center">
        <p className="text-xs tracking-[0.18em] text-accent">{profile.name}</p>
        {!result && !error ? <h1 className="mt-6 text-3xl font-semibold">기록하는 중</h1> : null}
        {error ? (
          <>
            <h1 className="mt-6 text-2xl font-semibold">기록하지 못했습니다</h1>
            <p className="mt-3 text-sm leading-6 text-danger">{error}</p>
            <Button className="mt-6" onClick={() => setAttempt((value) => value + 1)}>
              다시 기록
            </Button>
          </>
        ) : null}
        {result ? (
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
          </>
        ) : null}
        <Link to="/" className="mt-8 inline-block text-sm text-muted underline-offset-4 hover:underline">
          내 근태 보기
        </Link>
      </div>
    </main>
  )
}
