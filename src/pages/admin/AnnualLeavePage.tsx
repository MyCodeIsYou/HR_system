import { useEffect, useState } from "react"
import { Field, Page } from "../../components/ui.tsx"
import { formatLeaveDays, humanError, seoulToday } from "../../lib/format.ts"
import { supabase } from "../../lib/supabase.ts"
import type { Profile } from "../../types.ts"

type LedgerRow = {
  user_id: string
  delta_minutes: number
  work_date: string | null
  created_at: string
}

type Row = {
  id: string
  name: string
  carried: number
  granted: number
  used: number
  remaining: number
}

function seoulYear(date = new Date()): number {
  return Number(seoulToday(date).slice(0, 4))
}

function entryYear(entry: LedgerRow): number {
  const day = entry.work_date ?? seoulToday(new Date(entry.created_at))
  return Number(day.slice(0, 4))
}

export function AnnualLeavePage() {
  const currentYear = seoulYear()
  const [year, setYear] = useState(currentYear)
  const [rows, setRows] = useState<Row[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void Promise.all([
      supabase.from("profiles").select("id, name").order("name"),
      supabase.from("leave_ledger").select("user_id, delta_minutes, work_date, created_at").eq("leave_type", "annual"),
    ])
      .then(([profileResult, ledgerResult]) => {
        if (!active) return
        if (profileResult.error) throw profileResult.error
        if (ledgerResult.error) throw ledgerResult.error
        const profiles = (profileResult.data ?? []) as Pick<Profile, "id" | "name">[]
        const ledger = (ledgerResult.data ?? []) as LedgerRow[]
        setRows(
          profiles.map((member) => {
            const mine = ledger.filter((entry) => entry.user_id === member.id)
            const carried = mine.reduce((sum, entry) => (entryYear(entry) < year ? sum + entry.delta_minutes : sum), 0)
            const thisYear = mine.filter((entry) => entryYear(entry) === year)
            const granted = thisYear.reduce((sum, entry) => sum + (entry.delta_minutes > 0 ? entry.delta_minutes : 0), 0)
            const used = thisYear.reduce((sum, entry) => sum + (entry.delta_minutes < 0 ? -entry.delta_minutes : 0), 0)
            return { id: member.id, name: member.name, carried, granted, used, remaining: carried + granted - used }
          }),
        )
      })
      .catch((caught: unknown) => {
        if (active) setError(humanError(caught))
      })
    return () => {
      active = false
    }
  }, [year])

  const totals = rows.reduce(
    (sum, row) => ({
      carried: sum.carried + row.carried,
      granted: sum.granted + row.granted,
      used: sum.used + row.used,
      remaining: sum.remaining + row.remaining,
    }),
    { carried: 0, granted: 0, used: 0, remaining: 0 },
  )
  const years = [currentYear, currentYear - 1, currentYear - 2, currentYear - 3, currentYear - 4]

  return (
    <Page
      title="연차"
      description="구성원별 기본 연차입니다. 연차 1일, 반차 0.5일, 반반차 0.25일입니다. 잔여는 이월과 그해 지급에서 사용을 뺀 값입니다."
    >
      {error ? <p className="mb-4 text-sm text-danger">{error}</p> : null}
      <div className="mb-3 w-28">
        <Field compact label="연도">
          <select value={year} onChange={(event) => setYear(Number(event.target.value))}>
            {years.map((value) => (
              <option key={value} value={value}>
                {value}년
              </option>
            ))}
          </select>
        </Field>
      </div>
      {rows.length === 0 ? <p className="text-xs text-muted">구성원이 없습니다.</p> : null}
      {rows.length > 0 ? (
        <div className="ds-table is-compact max-w-3xl">
          <table className="w-full text-left">
            <thead className="text-muted">
              <tr>
                <th className="font-medium">구성원</th>
                <th className="font-medium">이월</th>
                <th className="font-medium">지급</th>
                <th className="font-medium">사용</th>
                <th className="font-medium">잔여</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td className="tabular-nums">{formatLeaveDays(row.carried)}</td>
                  <td className="tabular-nums">{formatLeaveDays(row.granted)}</td>
                  <td className="tabular-nums">{formatLeaveDays(row.used)}</td>
                  <td className={`tabular-nums ${row.remaining < 0 ? "text-danger" : ""}`}>{formatLeaveDays(row.remaining)}</td>
                </tr>
              ))}
              <tr>
                <td className="font-medium">합계</td>
                <td className="tabular-nums font-medium">{formatLeaveDays(totals.carried)}</td>
                <td className="tabular-nums font-medium">{formatLeaveDays(totals.granted)}</td>
                <td className="tabular-nums font-medium">{formatLeaveDays(totals.used)}</td>
                <td className={`tabular-nums font-medium ${totals.remaining < 0 ? "text-danger" : ""}`}>{formatLeaveDays(totals.remaining)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </Page>
  )
}
