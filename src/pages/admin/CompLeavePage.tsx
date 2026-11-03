import { useEffect, useState } from "react"
import { Card, Empty, Page } from "../../components/ui.tsx"
import { formatDate, formatDateTime, formatMinutes, humanError, oneName } from "../../lib/format.ts"
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
    <Page title="보상휴가" description="퇴근이 야근 인정 시각을 넘기면 사업장 비율대로 보상휴가가 쌓입니다. 잔액은 원장의 합입니다.">
      {error ? <p className="mb-4 text-sm text-danger">{humanError(new Error(error))}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {balances.map((row) => (
          <Card key={row.user_id}>
            <p className="text-sm text-muted">{row.name}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{formatMinutes(row.balance_minutes)}</p>
          </Card>
        ))}
      </div>
      {balances.length === 0 ? <Empty>쌓인 보상휴가가 없습니다.</Empty> : null}
      <h2 className="mt-8 mb-3 text-lg font-semibold">발생 내역</h2>
      {entries.length === 0 ? <Empty>내역이 없습니다.</Empty> : null}
      <div className="space-y-2">
        {entries.map((entry) => (
          <Card key={entry.id} className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium">{oneName(entry.subject)}</p>
              <p className="text-sm text-muted">
                {entry.reason}
                {entry.work_date ? ` · ${formatDate(entry.work_date)}` : ""} · {formatDateTime(entry.created_at)}
              </p>
            </div>
            <p className={`tabular-nums ${entry.delta_minutes < 0 ? "text-danger" : "text-ok"}`}>
              {entry.delta_minutes > 0 ? "+" : ""}
              {formatMinutes(entry.delta_minutes)}
            </p>
          </Card>
        ))}
      </div>
    </Page>
  )
}
