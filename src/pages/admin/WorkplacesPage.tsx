import { useEffect, useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import { useAuth } from "../../auth/AuthContext.tsx"
import { Alert, Button, Empty, Field, Modal, Page } from "../../components/ui.tsx"
import { workplaceToken } from "../../lib/api.ts"
import { clockLabel, formatWon, humanError, latePolicyLabel } from "../../lib/format.ts"
import { supabase } from "../../lib/supabase.ts"
import { workplaceColumns, type Workplace } from "../../types.ts"

function sanctionLabel(workplace: Workplace): string {
  if (workplace.late_policy === "fine") {
    if (workplace.fine_mode === "per_minute") return `분당 ${formatWon(workplace.fine_amount)}`
    if (workplace.fine_mode === "step") {
      return `처음 ${workplace.fine_initial_minutes}분 ${formatWon(workplace.fine_initial_amount)}, 이후 ${workplace.fine_step_minutes}분마다 ${formatWon(workplace.fine_step_amount)}`
    }
    return `1회 ${formatWon(workplace.fine_amount)}`
  }
  if (workplace.late_policy === "annual_leave") {
    if (workplace.leave_deduction_mode === "per_occurrence") return `연차 차감, 1회 ${workplace.leave_deduction_minutes}분`
    return "연차 차감, 지각한 분만큼"
  }
  return latePolicyLabel(workplace.late_policy)
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-sm break-words">{value}</dd>
    </div>
  )
}

export function WorkplacesPage() {
  const { organization, refresh } = useAuth()
  const [rows, setRows] = useState<Workplace[]>([])
  const [name, setName] = useState(organization?.name ?? "")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [detail, setDetail] = useState<Workplace | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [tokenError, setTokenError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setName(organization?.name ?? "")
  }, [organization?.name])

  useEffect(() => {
    if (!detail) return
    let active = true
    setToken(null)
    setTokenError(null)
    setCopied(false)
    void workplaceToken(detail.id)
      .then((value) => {
        if (active) setToken(value)
      })
      .catch((caught: unknown) => {
        if (active) setTokenError(humanError(caught))
      })
    return () => {
      active = false
    }
  }, [detail])

  useEffect(() => {
    let active = true
    void supabase
      .from("workplaces")
      .select(workplaceColumns)
      .order("name")
      .then(({ data, error: queryError }) => {
        if (!active) return
        if (queryError) setError(queryError.message)
        else setRows((data ?? []) as Workplace[])
      })
    return () => {
      active = false
    }
  }, [])

  async function rename(event: FormEvent) {
    event.preventDefault()
    if (!organization) return
    setPending(true)
    setError(null)
    const { error: updateError } = await supabase.from("organizations").update({ name: name.trim() }).eq("id", organization.id)
    setPending(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    setRenameOpen(false)
    await refresh()
  }

  return (
    <Page
      title="사업장"
      description="사업장마다 NFC 주소가 다릅니다. 카드에는 그 주소만 적습니다."
      action={
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setRenameOpen(true)}>조직 이름</Button>
          <Link to="/admin/workplaces/new" className="ds-button">사업장 추가</Link>
        </div>
      }
    >
      {error && !renameOpen ? <div className="mb-4"><Alert>{humanError(new Error(error))}</Alert></div> : null}
      {renameOpen ? (
        <Modal title="조직 이름" onClose={() => setRenameOpen(false)}>
          {error ? <div className="mb-3"><Alert>{humanError(new Error(error))}</Alert></div> : null}
          <form className="grid gap-3" onSubmit={(event) => void rename(event)}>
            <Field compact label="조직 이름">
              <input value={name} onChange={(event) => setName(event.target.value)} required />
            </Field>
            <Button type="submit" disabled={pending}>{pending ? "저장 중" : "이름 저장"}</Button>
          </form>
        </Modal>
      ) : null}
      {rows.length === 0 ? <Empty>등록된 사업장이 없습니다.</Empty> : null}
      {rows.length > 0 ? (
        <div className="ds-table is-compact max-w-3xl">
          <table className="w-full text-left">
            <thead className="text-muted">
              <tr>
                <th className="font-medium">이름</th>
                <th className="font-medium">주소</th>
                <th className="font-medium">근무</th>
                <th className="font-medium">지각</th>
                <th className="font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((workplace) => (
                <tr key={workplace.id}>
                  <td>
                    <Link to={`/admin/workplaces/${workplace.id}`} className="font-medium text-accent underline-offset-4 hover:underline">
                      {workplace.name}
                    </Link>
                  </td>
                  <td>{workplace.address || "주소 없음"}</td>
                  <td className="tabular-nums">{clockLabel(workplace.work_start)}–{clockLabel(workplace.work_end)}</td>
                  <td>{latePolicyLabel(workplace.late_policy)}</td>
                  <td>
                    <button type="button" className="ds-icon-button is-sm" aria-label="상세" onClick={() => setDetail(workplace)}>
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
                        <circle cx="12" cy="12" r="2.5" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {detail ? (
        <WorkplaceDetail
          workplace={detail}
          token={token}
          tokenError={tokenError}
          copied={copied}
          onCopied={() => setCopied(true)}
          onClose={() => setDetail(null)}
        />
      ) : null}
    </Page>
  )
}

function WorkplaceDetail({
  workplace,
  token,
  tokenError,
  copied,
  onCopied,
  onClose,
}: {
  workplace: Workplace
  token: string | null
  tokenError: string | null
  copied: boolean
  onCopied: () => void
  onClose: () => void
}) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "")
  const link = token ? `${window.location.origin}${base}/c/${token}` : ""

  return (
    <Modal
      title={workplace.name}
      onClose={onClose}
      footer={
        <Link to={`/admin/workplaces/${workplace.id}`} className="ds-button w-full">
          수정
        </Link>
      }
    >
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Fact label="주소" value={workplace.address || "없음"} />
        </div>
        <Fact label="시간대" value={workplace.timezone} />
        <Fact label="근무" value={`${clockLabel(workplace.work_start)}–${clockLabel(workplace.work_end)}`} />
        <Fact label="지각 유예" value={`${workplace.late_grace_minutes}분`} />
        <Fact label="지각 제재" value={sanctionLabel(workplace)} />
        <Fact label="야근 인정" value={`${clockLabel(workplace.overtime_start)} 이후`} />
        <Fact
          label="보상휴가"
          value={`야근 ${workplace.comp_leave_ratio_overtime_minutes}분당 ${workplace.comp_leave_ratio_leave_minutes}분`}
        />
      </dl>
      <div className="mt-4">
        <p className="text-xs text-muted">NFC 주소</p>
        {tokenError ? <p className="mt-1 text-sm text-danger">{tokenError}</p> : null}
        {link ? <p className="mt-1 text-sm leading-6 break-all">{link}</p> : null}
        {!link && !tokenError ? <p className="mt-1 text-sm text-muted">불러오는 중</p> : null}
        {link ? (
          <Button
            className="mt-3"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard.writeText(link).then(onCopied)
            }}
          >
            {copied ? "복사함" : "주소 복사"}
          </Button>
        ) : null}
      </div>
    </Modal>
  )
}
