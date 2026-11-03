import { useEffect, useState } from "react"
import { Page } from "../../components/ui.tsx"
import { formatDate, formatDateTime, formatLeaveDays, humanError, oneName } from "../../lib/format.ts"
import { supabase } from "../../lib/supabase.ts"
import type { LeaveBalance, LeaveLedgerEntry, Profile } from "../../types.ts"

export function CompLeavePage() {
  const [entries, setEntries] = useState<LeaveLedgerEntry[]>([])
  const [balances, setBalances] = useState<Array<LeaveBalance & { name: string }>>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void Promise.all([
      supabase
        .from("leave_ledger")
        .select("id, user_id, leave_type, delta_minutes, reason, work_date, created_at, subject:profiles!leave_ledger_user_id_fkey(name)")
        .eq("leave_type", "comp")
        .order("created_at", { ascending: false })
        .limit(200),
      supabase.from("leave_balance_sums").select("user_id, leave_type, balance_minutes").eq("leave_type", "comp"),
      supabase.from("profiles").select("id, name"),
    ]).then(([ledgerResult, balanceResult, profileResult]) => {
      if (!active) return
      if (ledgerResult.error) {
        setError(ledgerResult.error.message)
        return
      }
      if (balanceResult.error) {
        setError(balanceResult.error.message)
        return
      }
      if (profileResult.error) {
        setError(profileResult.error.message)
        return
      }
      const profiles = (profileResult.data ?? []) as Pick<Profile, "id" | "name">[]
      setEntries((ledgerResult.data ?? []) as LeaveLedgerEntry[])
      setBalances(
        ((balanceResult.data ?? []) as LeaveBalance[]).map((row) => ({
          ...row,
          name: profiles.find((profile) => profile.id === row.user_id)?.name ?? "이름 없음",
        })),
      )
    })
    return () => {
      active = false
    }
  }, [])

  return (
    <Page title="보상휴가" description="퇴근이 야근 인정 시각을 넘기면 보상휴가가 쌓입니다. 1일, 반차 0.5일, 반반차 0.25일입니다.">
      {error ? <p className="mb-4 text-sm text-danger">{humanError(new Error(error))}</p> : null}
      {balances.length === 0 ? <p className="text-xs text-muted">쌓인 보상휴가가 없습니다.</p> : null}
      {balances.length > 0 ? (
        <div className="ds-table is-compact max-w-3xl">
          <table className="w-full text-left">
            <thead className="text-muted">
              <tr>
                <th className="font-medium">구성원</th>
                <th className="font-medium">잔여</th>
              </tr>
            </thead>
            <tbody>
              {balances.map((row) => (
                <tr key={row.user_id}>
                  <td>{row.name}</td>
                  <td className="tabular-nums">{formatLeaveDays(row.balance_minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <h2 className="mt-5 mb-2 text-sm font-semibold">발생 내역</h2>
      {entries.length === 0 ? <p className="text-xs text-muted">내역이 없습니다.</p> : null}
      {entries.length > 0 ? (
        <div className="ds-table is-compact max-w-3xl">
          <table className="w-full text-left">
            <thead className="text-muted">
              <tr>
                <th className="font-medium">구성원</th>
                <th className="font-medium">변경</th>
                <th className="font-medium">사유</th>
                <th className="font-medium">근무일</th>
                <th className="font-medium">시각</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{oneName(entry.subject)}</td>
                  <td className={`tabular-nums ${entry.delta_minutes < 0 ? "text-danger" : "text-ok"}`}>
                    {entry.delta_minutes > 0 ? "+" : ""}
                    {formatLeaveDays(entry.delta_minutes)}
                  </td>
                  <td>{entry.reason}</td>
                  <td>{entry.work_date ? formatDate(entry.work_date) : ""}</td>
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
