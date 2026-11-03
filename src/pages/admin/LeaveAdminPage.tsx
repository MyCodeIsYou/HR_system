import { useEffect, useState } from "react"
import { Alert, Empty, Page, Toast } from "../../components/ui.tsx"
import { adjustLeave } from "../../lib/api.ts"
import { formatDateTime, formatMinutes, humanError, oneName } from "../../lib/format.ts"
import { supabase } from "../../lib/supabase.ts"
import type { LeaveBalance, LeaveLedgerEntry, LeaveType, Profile } from "../../types.ts"

type MemberLeave = {
  id: string
  name: string
  role: Profile["role"]
  annual: number
  comp: number
  annualDraft: string
  compDraft: string
}

function daysLabel(minutes: number): string {
  const days = Math.round((minutes / 480) * 1000) / 1000
  return String(days)
}

function draftMinutes(value: string): number | null {
  const days = Number(value)
  if (!Number.isFinite(days)) return null
  return Math.round(days * 480)
}

export function LeaveAdminPage() {
  const [members, setMembers] = useState<MemberLeave[]>([])
  const [entries, setEntries] = useState<LeaveLedgerEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  async function load() {
    const [profileResult, balanceResult, ledgerResult] = await Promise.all([
      supabase.from("profiles").select("id, name, role").order("name"),
      supabase.from("leave_balance_sums").select("user_id, leave_type, balance_minutes"),
      supabase
        .from("leave_ledger")
        .select("id, user_id, leave_type, delta_minutes, reason, work_date, created_at, subject:profiles!leave_ledger_user_id_fkey(name)")
        .order("created_at", { ascending: false })
        .limit(40),
    ])
    if (profileResult.error) throw profileResult.error
    if (balanceResult.error) throw balanceResult.error
    if (ledgerResult.error) throw ledgerResult.error
    const balances = (balanceResult.data ?? []) as LeaveBalance[]
    setMembers(
      ((profileResult.data ?? []) as Pick<Profile, "id" | "name" | "role">[]).map((member) => {
        const annual = balances.find((row) => row.user_id === member.id && row.leave_type === "annual")?.balance_minutes ?? 0
        const comp = balances.find((row) => row.user_id === member.id && row.leave_type === "comp")?.balance_minutes ?? 0
        return {
          id: member.id,
          name: member.name,
          role: member.role,
          annual,
          comp,
          annualDraft: daysLabel(annual),
          compDraft: daysLabel(comp),
        }
      }),
    )
    setEntries((ledgerResult.data ?? []) as LeaveLedgerEntry[])
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
        return leaveType === "annual" ? { ...row, annualDraft: value } : { ...row, compDraft: value }
      }),
    )
  }

  async function commit(member: MemberLeave, leaveType: LeaveType, draft: string) {
    const current = leaveType === "annual" ? member.annual : member.comp
    const target = draftMinutes(draft)
    if (target === null) {
      updateDraft(member.id, leaveType, daysLabel(current))
      setError("일수는 숫자로 입력하세요.")
      return
    }
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
        reason: leaveType === "annual" ? "기본 연차 수정" : "보상휴가 수정",
      })
      setMembers((rows) =>
        rows.map((row) => {
          if (row.id !== member.id) return row
          return leaveType === "annual"
            ? { ...row, annual: target, annualDraft: daysLabel(target) }
            : { ...row, comp: target, compDraft: daysLabel(target) }
        }),
      )
      setMessage(`${member.name}의 ${leaveType === "annual" ? "기본 연차" : "보상휴가"}를 ${daysLabel(target)}일로 저장했습니다.`)
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

  return (
    <Page
      title="휴가"
      description="표의 일수를 고치고 칸 밖을 누르거나 Enter를 치면 바로 저장됩니다. 1일은 8시간입니다."
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
      {members.length === 0 ? <Empty>구성원이 없습니다.</Empty> : null}
      {members.length > 0 ? (
        <div className="ds-table">
          <table>
            <thead>
              <tr>
                <th>구성원</th>
                <th>기본 연차(일)</th>
                <th>보상휴가(일)</th>
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
                    <input
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
                    <p className="mt-1 text-xs text-muted">{formatMinutes(member.annual)}</p>
                  </td>
                  <td>
                    <input
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
                    <p className="mt-1 text-xs text-muted">{formatMinutes(member.comp)}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <h2 className="mt-8 mb-3 text-lg font-semibold">변경 내역</h2>
      {entries.length === 0 ? <Empty>휴가 원장 내역이 없습니다.</Empty> : null}
      {entries.length > 0 ? (
        <div className="ds-table">
          <table>
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
                  <td>{entry.leave_type === "annual" ? "기본 연차" : "보상휴가"}</td>
                  <td className={entry.delta_minutes < 0 ? "text-danger" : "text-ok"}>
                    {entry.delta_minutes > 0 ? "+" : ""}
                    {formatMinutes(entry.delta_minutes)}
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
