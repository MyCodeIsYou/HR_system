import { useEffect, useState, type FormEvent } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { useAuth } from "../../auth/AuthContext.tsx"
import { Alert, Button, Card, Field, Notice, Page } from "../../components/ui.tsx"
import { rotateWorkplaceToken, workplaceToken } from "../../lib/api.ts"
import { nfcCheckinUrl } from "../../lib/checkinLink.ts"
import { clockLabel, humanError } from "../../lib/format.ts"
import { supabase } from "../../lib/supabase.ts"
import type { FineMode, LatePolicy, LeaveDeductionMode, Workplace } from "../../types.ts"
import { workplaceColumns } from "../../types.ts"

type Draft = {
  name: string
  address: string
  timezone: string
  work_start: string
  work_end: string
  late_grace_minutes: string
  late_policy: LatePolicy
  fine_mode: FineMode
  fine_amount: string
  fine_initial_minutes: string
  fine_initial_amount: string
  fine_step_minutes: string
  fine_step_amount: string
  leave_deduction_mode: LeaveDeductionMode
  leave_deduction_minutes: string
  overtime_start: string
  comp_leave_ratio_overtime_minutes: string
  comp_leave_ratio_leave_minutes: string
}

const emptyDraft: Draft = {
  name: "",
  address: "",
  timezone: "Asia/Seoul",
  work_start: "09:00",
  work_end: "18:00",
  late_grace_minutes: "0",
  late_policy: "none",
  fine_mode: "flat",
  fine_amount: "0",
  fine_initial_minutes: "10",
  fine_initial_amount: "5000",
  fine_step_minutes: "10",
  fine_step_amount: "2000",
  leave_deduction_mode: "exact_minutes",
  leave_deduction_minutes: "60",
  overtime_start: "18:00",
  comp_leave_ratio_overtime_minutes: "1",
  comp_leave_ratio_leave_minutes: "1",
}

function fromWorkplace(workplace: Workplace): Draft {
  return {
    name: workplace.name,
    address: workplace.address ?? "",
    timezone: workplace.timezone,
    work_start: clockLabel(workplace.work_start),
    work_end: clockLabel(workplace.work_end),
    late_grace_minutes: String(workplace.late_grace_minutes),
    late_policy: workplace.late_policy,
    fine_mode: workplace.fine_mode,
    fine_amount: String(workplace.fine_amount),
    fine_initial_minutes: String(workplace.fine_initial_minutes),
    fine_initial_amount: String(workplace.fine_initial_amount),
    fine_step_minutes: String(workplace.fine_step_minutes),
    fine_step_amount: String(workplace.fine_step_amount),
    leave_deduction_mode: workplace.leave_deduction_mode,
    leave_deduction_minutes: String(workplace.leave_deduction_minutes),
    overtime_start: clockLabel(workplace.overtime_start),
    comp_leave_ratio_overtime_minutes: String(workplace.comp_leave_ratio_overtime_minutes),
    comp_leave_ratio_leave_minutes: String(workplace.comp_leave_ratio_leave_minutes),
  }
}

function integer(value: string, label: string, min: number): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new Error(`${label}은 ${min} 이상의 정수여야 합니다.`)
  }
  return parsed
}

export function WorkplaceFormPage() {
  const { workplaceId } = useParams()
  const navigate = useNavigate()
  const { organization } = useAuth()
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [confirmRotate, setConfirmRotate] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!workplaceId) return
    let active = true
    void supabase
      .from("workplaces")
      .select(workplaceColumns)
      .eq("id", workplaceId)
      .maybeSingle()
      .then(({ data, error: queryError }) => {
        if (!active) return
        if (queryError) setError(queryError.message)
        else if (data) setDraft(fromWorkplace(data as Workplace))
        else setError("사업장을 찾을 수 없습니다.")
      })
    void workplaceToken(workplaceId)
      .then((value) => {
        if (active) setToken(value)
      })
      .catch((caught: unknown) => {
        if (active) setError(humanError(caught))
      })
    return () => {
      active = false
    }
  }, [workplaceId])

  function patch<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!organization) return
    setPending(true)
    setError(null)
    try {
      const payload = {
        organization_id: organization.id,
        name: draft.name.trim(),
        address: draft.address.trim() || null,
        timezone: draft.timezone.trim(),
        work_start: draft.work_start,
        work_end: draft.work_end,
        late_grace_minutes: integer(draft.late_grace_minutes, "지각 유예", 0),
        late_policy: draft.late_policy,
        fine_mode: draft.fine_mode,
        fine_amount: integer(draft.fine_amount, "벌금", 0),
        fine_initial_minutes: integer(draft.fine_initial_minutes, "처음 구간", 1),
        fine_initial_amount: integer(draft.fine_initial_amount, "처음 벌금", 0),
        fine_step_minutes: integer(draft.fine_step_minutes, "이후 구간", 1),
        fine_step_amount: integer(draft.fine_step_amount, "추가 벌금", 0),
        leave_deduction_mode: draft.leave_deduction_mode,
        leave_deduction_minutes: integer(draft.leave_deduction_minutes, "1회 차감 분", 0),
        overtime_start: draft.overtime_start,
        comp_leave_ratio_overtime_minutes: integer(draft.comp_leave_ratio_overtime_minutes, "야근 비율", 1),
        comp_leave_ratio_leave_minutes: integer(draft.comp_leave_ratio_leave_minutes, "휴가 비율", 1),
      }
      if (workplaceId) {
        const { error: updateError } = await supabase.from("workplaces").update(payload).eq("id", workplaceId)
        if (updateError) throw updateError
        navigate("/admin/workplaces")
      } else {
        const { data, error: insertError } = await supabase.from("workplaces").insert(payload).select("id").single()
        if (insertError) throw insertError
        navigate(`/admin/workplaces/${(data as { id: string }).id}`, { replace: true })
      }
    } catch (caught) {
      setError(humanError(caught))
    } finally {
      setPending(false)
    }
  }

  async function rotate() {
    if (!workplaceId) return
    setPending(true)
    setError(null)
    try {
      setToken(await rotateWorkplaceToken(workplaceId))
      setConfirmRotate(false)
      setCopied(false)
    } catch (caught) {
      setError(humanError(caught))
    } finally {
      setPending(false)
    }
  }

  async function remove() {
    if (!workplaceId) return
    setPending(true)
    setError(null)
    const { error: deleteError } = await supabase.from("workplaces").delete().eq("id", workplaceId)
    setPending(false)
    if (deleteError) {
      setError(humanError(deleteError))
      return
    }
    navigate("/admin/workplaces")
  }

  const nfcLink = token ? nfcCheckinUrl(token) : ""

  return (
    <Page
      title={workplaceId ? "사업장 수정" : "사업장 추가"}
      description="지각은 유예를 넘긴 뒤 기준 출근 시각부터 분을 올립니다. 대기 중이거나 승인된 오전반차·오전반반차가 있으면 그날 출근 기준이 휴가 시간만큼 늦어집니다. 야근은 출근 시각과 야근 인정 시작 중 늦은 쪽부터 퇴근까지이며, 비율을 곱해 분 단위로 반올림합니다."
      action={
        <Link to="/admin/workplaces" className="text-sm text-muted underline-offset-4 hover:underline">
          목록
        </Link>
      }
    >
      <form className="grid gap-4" onSubmit={(event) => void onSubmit(event)}>
        <Card className="grid gap-4 sm:grid-cols-2">
          <Field label="이름">
            <input value={draft.name} onChange={(event) => patch("name", event.target.value)} required />
          </Field>
          <Field label="주소">
            <input value={draft.address} onChange={(event) => patch("address", event.target.value)} />
          </Field>
          <Field label="시간대" hint="출퇴근 날짜와 기준 시각은 이 시간대로 계산합니다.">
            <input value={draft.timezone} onChange={(event) => patch("timezone", event.target.value)} required />
          </Field>
          <Field label="기준 출근" hint="지각은 이 시각과 유예를 기준으로 계산합니다.">
            <input type="time" value={draft.work_start} onChange={(event) => patch("work_start", event.target.value)} required />
          </Field>
          <Field label="기준 퇴근" hint="그날 자정까지 퇴근이 없으면 이 시각으로 퇴근 처리합니다.">
            <input type="time" value={draft.work_end} onChange={(event) => patch("work_end", event.target.value)} required />
          </Field>
          <Field label="지각 유예(분)">
            <input inputMode="numeric" value={draft.late_grace_minutes} onChange={(event) => patch("late_grace_minutes", event.target.value)} required />
          </Field>
          <Field label="지각 제재">
            <select value={draft.late_policy} onChange={(event) => patch("late_policy", event.target.value as LatePolicy)}>
              <option value="none">제재 없음</option>
              <option value="fine">벌금</option>
              <option value="annual_leave">연차 차감</option>
            </select>
          </Field>
          {draft.late_policy === "fine" ? (
            <>
              <Field label="벌금 방식">
                <select value={draft.fine_mode} onChange={(event) => patch("fine_mode", event.target.value as FineMode)}>
                  <option value="flat">지각 1회 정액</option>
                  <option value="per_minute">분당</option>
                  <option value="step">구간 가산</option>
                </select>
              </Field>
              {draft.fine_mode === "step" ? (
                <>
                  <Field label="처음 구간(분)" hint="이 시간까지는 처음 벌금만 부과됩니다.">
                    <input inputMode="numeric" value={draft.fine_initial_minutes} onChange={(event) => patch("fine_initial_minutes", event.target.value)} required />
                  </Field>
                  <Field label="처음 벌금(원)">
                    <input inputMode="numeric" value={draft.fine_initial_amount} onChange={(event) => patch("fine_initial_amount", event.target.value)} required />
                  </Field>
                  <Field label="이후 구간(분)" hint="처음 구간이 지난 뒤, 이 시간마다 추가 벌금이 계속 더해집니다.">
                    <input inputMode="numeric" value={draft.fine_step_minutes} onChange={(event) => patch("fine_step_minutes", event.target.value)} required />
                  </Field>
                  <Field label="추가 벌금(원)">
                    <input inputMode="numeric" value={draft.fine_step_amount} onChange={(event) => patch("fine_step_amount", event.target.value)} required />
                  </Field>
                </>
              ) : (
                <Field label={draft.fine_mode === "per_minute" ? "분당 벌금(원)" : "1회 벌금(원)"}>
                  <input inputMode="numeric" value={draft.fine_amount} onChange={(event) => patch("fine_amount", event.target.value)} required />
                </Field>
              )}
            </>
          ) : null}
          {draft.late_policy === "annual_leave" ? (
            <>
              <Field label="연차 차감 방식">
                <select
                  value={draft.leave_deduction_mode}
                  onChange={(event) => patch("leave_deduction_mode", event.target.value as LeaveDeductionMode)}
                >
                  <option value="exact_minutes">지각한 분만큼</option>
                  <option value="per_occurrence">1회당 정해진 분</option>
                </select>
              </Field>
              {draft.leave_deduction_mode === "per_occurrence" ? (
                <Field label="1회 차감(분)">
                  <input
                    inputMode="numeric"
                    value={draft.leave_deduction_minutes}
                    onChange={(event) => patch("leave_deduction_minutes", event.target.value)}
                    required
                  />
                </Field>
              ) : null}
            </>
          ) : null}
          <Field label="야근 인정 시작" hint="이 시각 이후의 출근은 지각이 아닙니다. 그날 다른 출근이 없어도 이 시각이 야근 시작입니다.">
            <input type="time" value={draft.overtime_start} onChange={(event) => patch("overtime_start", event.target.value)} required />
          </Field>
          <Field label="야근 분" hint="이 분마다 오른쪽 분만큼 보상휴가를 줍니다. 기본은 1분당 1분입니다.">
            <input
              inputMode="numeric"
              value={draft.comp_leave_ratio_overtime_minutes}
              onChange={(event) => patch("comp_leave_ratio_overtime_minutes", event.target.value)}
              required
            />
          </Field>
          <Field label="보상휴가 분">
            <input
              inputMode="numeric"
              value={draft.comp_leave_ratio_leave_minutes}
              onChange={(event) => patch("comp_leave_ratio_leave_minutes", event.target.value)}
              required
            />
          </Field>
        </Card>
        {error ? <Alert>{error}</Alert> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "저장 중" : "저장"}
          </Button>
          {workplaceId ? (
            <Button variant="danger" disabled={pending} onClick={() => void remove()}>
              삭제
            </Button>
          ) : null}
        </div>
      </form>

      {workplaceId && nfcLink ? (
        <Card className="mt-6">
          <h2 className="font-semibold">NFC 주소</h2>
          <p className="mt-2 text-sm leading-6 break-all">{nfcLink}</p>
          <p className="mt-2 text-xs leading-5 text-muted">카드에는 이 웹 주소를 적습니다. 안드로이드에서 페이지가 열리면 앱이 있는 폰은 앱으로 넘어가고, 앱이 없으면 이 페이지에서 출퇴근합니다.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                void navigator.clipboard.writeText(nfcLink).then(() => {
                  setCopied(true)
                })
              }}
            >
              {copied ? "복사함" : "주소 복사"}
            </Button>
            {confirmRotate ? (
              <Button variant="danger" disabled={pending} onClick={() => void rotate()}>
                재발급 확정
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmRotate(true)}>
                토큰 재발급
              </Button>
            )}
          </div>
          {confirmRotate ? <div className="mt-3"><Notice>재발급하면 기존 카드는 멈춥니다. 카드를 다시 써야 합니다.</Notice></div> : null}
        </Card>
      ) : null}
    </Page>
  )
}
