import { useEffect, useState } from "react"
import { useAuth } from "../../auth/AuthContext.tsx"
import { Alert, Button, Field, Page, Toast } from "../../components/ui.tsx"
import { LeaveKindsSection } from "./LeaveKindsSection.tsx"
import { adjustLeave, reviewLeaveRequest } from "../../lib/api.ts"
import { formatDate, formatDateTime, formatLeaveDays, humanError, leaveDayValue, leaveTypeLabel, oneName, parseLeaveDays } from "../../lib/format.ts"
import { supabase } from "../../lib/supabase.ts"
import type { LeaveBalance, LeaveEntryMode, LeaveLedgerEntry, LeaveRequest, LeaveType, Profile } from "../../types.ts"

type MemberLeave = {
  id: string
  name: string
  role: Profile["role"]
  annual: number
  comp: number
  summer: number
  annualDraft: string
  compDraft: string
  summerDraft: string
}

function daysLabel(minutes: number): string {
  return leaveDayValue(minutes)
}

export function LeaveAdminPage() {
  const { organization, refresh } = useAuth()
  const [members, setMembers] = useState<MemberLeave[]>([])
  const [entries, setEntries] = useState<LeaveLedgerEntry[]>([])
  const [requests, setRequests] = useState<LeaveRequest[]>([])
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [mode, setMode] = useState<LeaveEntryMode>(organization?.leave_entry_mode ?? "request")

  useEffect(() => {
    setMode(organization?.leave_entry_mode ?? "request")
  }, [organization?.leave_entry_mode])

  async function load() {
    const [profileResult, balanceResult, ledgerResult, requestResult] = await Promise.all([
      supabase.from("profiles").select("id, name, role").order("name"),
      supabase.from("leave_balance_sums").select("user_id, leave_type, balance_minutes"),
      supabase
        .from("leave_ledger")
        .select("id, user_id, leave_type, delta_minutes, reason, work_date, created_at, subject:profiles!leave_ledger_user_id_fkey(name)")
        .order("created_at", { ascending: false })
        .limit(40),
      supabase
        .from("leave_requests")
        .select("id, user_id, leave_type, kind_name, work_date, minutes, status, note, subject:profiles!leave_requests_user_id_fkey(name)")
        .eq("status", "pending")
        .order("work_date"),
    ])
    if (profileResult.error) throw profileResult.error
    if (balanceResult.error) throw balanceResult.error
    if (ledgerResult.error) throw ledgerResult.error
    if (requestResult.error) throw requestResult.error
    const balances = (balanceResult.data ?? []) as LeaveBalance[]
    setMembers(
      ((profileResult.data ?? []) as Pick<Profile, "id" | "name" | "role">[]).map((member) => {
        const annual = balances.find((row) => row.user_id === member.id && row.leave_type === "annual")?.balance_minutes ?? 0
        const comp = balances.find((row) => row.user_id === member.id && row.leave_type === "comp")?.balance_minutes ?? 0
        const summer = balances.find((row) => row.user_id === member.id && row.leave_type === "summer")?.balance_minutes ?? 0
        return {
          id: member.id,
          name: member.name,
          role: member.role,
          annual,
          comp,
          summer,
          annualDraft: daysLabel(annual),
          compDraft: daysLabel(comp),
          summerDraft: daysLabel(summer),
        }
      }),
    )
    setEntries((ledgerResult.data ?? []) as LeaveLedgerEntry[])
    setRequests((requestResult.data ?? []) as LeaveRequest[])
  }

  useEffect(() => {
    let active = true
    void load().catch((caught: unknown) => {
      if (active) setError(humanError(caught))
    })
    return () => {
      active = false
    }
  }, [])

  function updateDraft(id: string, leaveType: LeaveType, value: string) {
    setMembers((rows) =>
      rows.map((row) => {
        if (row.id !== id) return row
        if (leaveType === "annual") return { ...row, annualDraft: value }
        if (leaveType === "comp") return { ...row, compDraft: value }
        return { ...row, summerDraft: value }
      }),
    )
  }

  async function commit(member: MemberLeave, leaveType: LeaveType, draft: string) {
    const current = leaveType === "annual" ? member.annual : leaveType === "comp" ? member.comp : member.summer
    const parsed = parseLeaveDays(draft)
    if ("error" in parsed) {
      updateDraft(member.id, leaveType, daysLabel(current))
      setError(parsed.error)
      return
    }
    const target = parsed.minutes
    const delta = target - current
    if (delta === 0) {
      updateDraft(member.id, leaveType, daysLabel(current))
      return
    }
    const key = `${member.id}:${leaveType}`
    setSavingKey(key)
    setError(null)
    setMessage(null)
    try {
      await adjustLeave({
        userId: member.id,
        leaveType,
        deltaMinutes: delta,
        reason: `${leaveTypeLabel(leaveType)} 수정`,
      })
      setMembers((rows) =>
        rows.map((row) => {
          if (row.id !== member.id) return row
          if (leaveType === "annual") return { ...row, annual: target, annualDraft: daysLabel(target) }
          if (leaveType === "comp") return { ...row, comp: target, compDraft: daysLabel(target) }
          return { ...row, summer: target, summerDraft: daysLabel(target) }
        }),
      )
      setMessage(`${member.name}의 ${leaveTypeLabel(leaveType)}를 ${daysLabel(target)}일로 저장했습니다.`)
      const { data, error: ledgerError } = await supabase
        .from("leave_ledger")
        .select("id, user_id, leave_type, delta_minutes, reason, work_date, created_at, subject:profiles!leave_ledger_user_id_fkey(name)")
        .order("created_at", { ascending: false })
        .limit(40)
      if (ledgerError) throw ledgerError
      setEntries((data ?? []) as LeaveLedgerEntry[])
    } catch (caught) {
      updateDraft(member.id, leaveType, daysLabel(current))
      setError(humanError(caught))
    } finally {
      setSavingKey(null)
    }
  }

  async function saveMode(next: LeaveEntryMode) {
    if (!organization) return
    const previous = mode
    setMode(next)
    setError(null)
    setMessage(null)
    const { error: updateError } = await supabase.from("organizations").update({ leave_entry_mode: next }).eq("id", organization.id)
    if (updateError) {
      setMode(previous)
      setError(humanError(new Error(updateError.message)))
      return
    }
    await refresh()
    setMessage(next === "register" ? "등록형으로 저장했습니다." : "신청형으로 저장했습니다.")
  }

  async function review(id: string, approve: boolean) {
    setSavingKey(id)
    setError(null)
    setMessage(null)
    try {
      await reviewLeaveRequest(id, approve)
      setMessage(approve ? "휴가를 승인했습니다." : "휴가를 거절했습니다.")
      await load()
    } catch (caught) {
      setError(humanError(caught))
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <Page
      title="휴가"
      description="표의 일수를 고치고 칸 밖을 누르거나 Enter를 치면 저장됩니다. 연차 1일, 반차 0.5일, 반반차 0.25일입니다."
    >
      {error ? (
        <div className="mb-4">
          <Alert>{error}</Alert>
        </div>
      ) : null}
      {message ? (
        <div className="mb-4">
          <Toast>{message}</Toast>
        </div>
      ) : null}
      <div className="mb-6 max-w-xs">
        <Field compact label="휴가 방식" hint={mode === "register" ? "구성원이 승인 없이 바로 등록합니다." : "구성원 신청을 관리자가 승인합니다."}>
          <select
            aria-label="휴가 방식"
            value={mode}
            onChange={(event) => void saveMode(event.target.value as LeaveEntryMode)}
          >
            <option value="request">신청형</option>
            <option value="register">등록형</option>
          </select>
        </Field>
      </div>
      <LeaveKindsSection />
      {mode === "request" || requests.length > 0 ? <h2 className="mb-2 text-sm font-semibold">휴가 신청</h2> : null}
      {mode === "request" || requests.length > 0 ? (
        requests.length === 0 ? <p className="mb-6 text-xs text-muted">대기 중인 신청이 없습니다.</p> : null
      ) : null}
      {requests.length > 0 ? (
        <div className="ds-table is-compact mb-6 max-w-3xl">
          <table className="w-full text-left">
            <thead>
              <tr>
                <th>날짜</th>
                <th>구성원</th>
                <th>휴가</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.id}>
                  <td>{formatDate(request.work_date)}</td>
                  <td>{oneName(request.subject)}</td>
                  <td>
                    {request.kind_name ?? (request.leave_type ? leaveTypeLabel(request.leave_type) : "휴가")} {formatLeaveDays(request.minutes)}
                  </td>
                  <td>
                    <span className="inline-flex gap-2">
                      <Button
                        disabled={savingKey === request.id}
                        onClick={() => void review(request.id, true)}
                      >
                        승인
                      </Button>
                      <Button variant="ghost" disabled={savingKey === request.id} onClick={() => void review(request.id, false)}>
                        거절
                      </Button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {members.length === 0 ? <p className="text-xs text-muted">구성원이 없습니다.</p> : null}
      {members.length > 0 ? (
        <div className="ds-table is-compact max-w-3xl">
          <table className="w-full text-left">
            <thead>
              <tr>
                <th>구성원</th>
                <th>기본 연차(일)</th>
                <th>보상휴가(일)</th>
                <th>여름휴가(일)</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id}>
                  <td>
                    {member.name}
                    {member.role === "admin" ? " · 관리자" : ""}
                  </td>
                  <td>
                    <span className="inline-flex items-center gap-2">
                      <input
                        style={{ width: "5.5rem" }}
                        inputMode="decimal"
                        aria-label={`${member.name} 기본 연차`}
                        value={member.annualDraft}
                        disabled={savingKey === `${member.id}:annual`}
                        onChange={(event) => updateDraft(member.id, "annual", event.target.value)}
                        onBlur={(event) => void commit(member, "annual", event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur()
                        }}
                      />
                      <span className="text-muted">{formatLeaveDays(member.annual)}</span>
                    </span>
                  </td>
                  <td>
                    <span className="inline-flex items-center gap-2">
                      <input
                        style={{ width: "5.5rem" }}
                        inputMode="decimal"
                        aria-label={`${member.name} 보상휴가`}
                        value={member.compDraft}
                        disabled={savingKey === `${member.id}:comp`}
                        onChange={(event) => updateDraft(member.id, "comp", event.target.value)}
                        onBlur={(event) => void commit(member, "comp", event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur()
                        }}
                      />
                      <span className="text-muted">{formatLeaveDays(member.comp)}</span>
                    </span>
                  </td>
                  <td>
                    <span className="inline-flex items-center gap-2">
                      <input
                        style={{ width: "5.5rem" }}
                        inputMode="decimal"
                        aria-label={`${member.name} 여름휴가`}
                        value={member.summerDraft}
                        disabled={savingKey === `${member.id}:summer`}
                        onChange={(event) => updateDraft(member.id, "summer", event.target.value)}
                        onBlur={(event) => void commit(member, "summer", event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur()
                        }}
                      />
                      <span className="text-muted">{formatLeaveDays(member.summer)}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <h2 className="mt-5 mb-2 text-sm font-semibold">변경 내역</h2>
      {entries.length === 0 ? <p className="text-xs text-muted">휴가 원장 내역이 없습니다.</p> : null}
      {entries.length > 0 ? (
        <div className="ds-table is-compact max-w-3xl">
          <table className="w-full text-left">
            <thead>
              <tr>
                <th>구성원</th>
                <th>종류</th>
                <th>변경</th>
                <th>사유</th>
                <th>시각</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{oneName(entry.subject)}</td>
                  <td>{leaveTypeLabel(entry.leave_type)}</td>
                  <td className={entry.delta_minutes < 0 ? "text-danger" : "text-ok"}>
                    {entry.delta_minutes > 0 ? "+" : ""}
                    {formatLeaveDays(entry.delta_minutes)}
                  </td>
                  <td>{entry.reason}</td>
                  <td>{formatDateTime(entry.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Page>
  )
}
