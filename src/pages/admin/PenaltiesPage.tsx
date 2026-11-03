import { useEffect, useState } from "react"
import { Page } from "../../components/ui.tsx"
import { formatDate, formatLeaveDays, formatWon, humanError, latePolicyLabel, oneName } from "../../lib/format.ts"
import { supabase } from "../../lib/supabase.ts"
import type { LatePenalty } from "../../types.ts"

export function PenaltiesPage() {
  const [rows, setRows] = useState<LatePenalty[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void supabase
      .from("late_penalties")
      .select("id, user_id, workplace_id, work_date, late_minutes, penalty_type, fine_amount, leave_minutes_deducted, voided_at, created_at, profiles(name), workplaces(name)")
      .order("work_date", { ascending: false })
      .limit(200)
      .then(({ data, error: queryError }) => {
        if (!active) return
        if (queryError) setError(queryError.message)
        else setRows((data ?? []) as LatePenalty[])
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <Page title="지각" description="유예를 넘긴 첫 출근만 지각으로 남습니다. 취소된 출퇴근은 흐리게 표시됩니다.">
      {error ? <p className="mb-4 text-sm text-danger">{humanError(new Error(error))}</p> : null}
      {rows.length === 0 ? <p className="text-xs text-muted">지각 기록이 없습니다.</p> : null}
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
