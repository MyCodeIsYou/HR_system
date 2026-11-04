import { useEffect, useState } from "react"
import { Page } from "../../components/ui.tsx"
import { formatDate, formatLeaveDays, formatWon, humanError, latePolicyLabel, oneName, seoulToday } from "../../lib/format.ts"
import { supabase } from "../../lib/supabase.ts"
import type { LatePenalty } from "../../types.ts"

const currentYear = Number(seoulToday().slice(0, 4))
const years = Array.from({ length: 6 }, (_, index) => currentYear - index)

export function PenaltiesPage() {
  const [year, setYear] = useState(currentYear)
  const [rows, setRows] = useState<LatePenalty[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setError(null)
    setRows([])
    void supabase
      .from("late_penalties")
      .select("id, user_id, workplace_id, work_date, late_minutes, penalty_type, fine_amount, leave_minutes_deducted, voided_at, created_at, profiles(name), workplaces(name)")
      .gte("work_date", `${year}-01-01`)
      .lte("work_date", `${year}-12-31`)
      .order("work_date", { ascending: false })
      .limit(2000)
      .then(({ data, error: queryError }) => {
        if (!active) return
        if (queryError) setError(queryError.message)
        else setRows((data ?? []) as LatePenalty[])
      })
    return () => {
      active = false
    }
  }, [year])

  const fineTotal = rows.reduce((sum, row) => {
    if (row.voided_at || row.penalty_type !== "fine") return sum
    return sum + row.fine_amount
  }, 0)

  return (
    <Page
      title="지각"
      description="유예를 넘긴 첫 출근만 지각으로 남습니다. 취소된 출퇴근은 흐리게 표시되고, 그 해 벌금에는 포함되지 않습니다."
      action={
        <select aria-label="연도" value={year} style={{ width: "7.5rem" }} onChange={(event) => setYear(Number(event.target.value))}>
          {years.map((value) => (
            <option key={value} value={value}>
              {value}년
            </option>
          ))}
        </select>
      }
    >
      {error ? <p className="mb-4 text-sm text-danger">{humanError(new Error(error))}</p> : null}
      <div className="ds-card ds-tone-rose mb-4 max-w-xs px-4 py-3">
        <p className="text-xs text-muted">{year}년 벌금</p>
        <p className="mt-1 text-lg font-semibold tabular-nums">{formatWon(fineTotal)}</p>
      </div>
      {rows.length === 0 ? <p className="text-xs text-muted">이 해의 지각 기록이 없습니다.</p> : null}
      {rows.length > 0 ? (
      <div className="ds-table is-compact max-w-3xl">
        <table className="w-full text-left">
          <thead className="text-muted">
            <tr>
              <th className="font-medium">날짜</th>
              <th className="font-medium">구성원</th>
              <th className="font-medium">사업장</th>
              <th className="font-medium">지각</th>
              <th className="font-medium">제재</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={row.voided_at ? "text-muted line-through" : undefined}>
                <td>{formatDate(row.work_date)}</td>
                <td>{oneName(row.profiles)}</td>
                <td>{oneName(row.workplaces)}</td>
                <td className="tabular-nums">{row.late_minutes}분</td>
                <td>
                  {latePolicyLabel(row.penalty_type)}
                  {row.penalty_type === "fine" ? ` ${formatWon(row.fine_amount)}` : ""}
                  {row.penalty_type === "annual_leave" ? ` ${formatLeaveDays(row.leave_minutes_deducted)}` : ""}
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
