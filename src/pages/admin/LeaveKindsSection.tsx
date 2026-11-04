import { useEffect, useState } from "react"
import { useAuth } from "../../auth/AuthContext.tsx"
import { Alert, Button, Field, Modal } from "../../components/ui.tsx"
import { deductLabel, formatLeaveDays, humanError, parseLeaveDays } from "../../lib/format.ts"
import { supabase } from "../../lib/supabase.ts"
import type { LeaveKind, LeaveType } from "../../types.ts"

type Draft = {
  id: string | null
  name: string
  days: string
  deduct: LeaveType | ""
  enabled: boolean
}

const emptyDraft: Draft = { id: null, name: "", days: "1", deduct: "annual", enabled: true }

export function LeaveKindsSection() {
  const { organization } = useAuth()
  const [kinds, setKinds] = useState<LeaveKind[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function load() {
    const { data, error: loadError } = await supabase
      .from("leave_kinds")
      .select("id, name, minutes, deduct_type, enabled, sort_order")
      .order("sort_order")
      .order("name")
    if (loadError) throw loadError
    setKinds((data ?? []) as LeaveKind[])
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

  function openCreate() {
    setError(null)
    setDraft(emptyDraft)
  }

  function openEdit(kind: LeaveKind) {
    setError(null)
    setDraft({
      id: kind.id,
      name: kind.name,
      days: String(kind.minutes / 480),
      deduct: kind.deduct_type ?? "",
      enabled: kind.enabled,
    })
  }

  async function save() {
    if (!draft) return
    const name = draft.name.trim()
    if (!name) {
      setError("이름을 입력하세요.")
      return
    }
    const parsed = parseLeaveDays(draft.days)
    if ("error" in parsed) {
      setError(parsed.error)
      return
    }
    if (parsed.minutes <= 0 || parsed.minutes > 14400) {
      setError("일수는 0.25일부터 30일까지 입력하세요.")
      return
    }
    setPending(true)
    setError(null)
    const payload = {
      name,
      minutes: parsed.minutes,
      deduct_type: draft.deduct || null,
      enabled: draft.enabled,
    }
    const result = draft.id
      ? await supabase.from("leave_kinds").update(payload).eq("id", draft.id)
      : organization
        ? await supabase.from("leave_kinds").insert({
            ...payload,
            organization_id: organization.id,
            sort_order: kinds.reduce((max, kind) => Math.max(max, kind.sort_order), 0) + 1,
          })
        : { error: { code: "", message: "조직이 없습니다." } }
    setPending(false)
    if (result.error) {
      setError(result.error.code === "23505" ? "같은 이름의 신청 종류가 있습니다." : humanError(new Error(result.error.message)))
      return
    }
    setDraft(null)
    try {
      await load()
    } catch (caught) {
      setError(humanError(caught))
    }
  }

  async function remove(kind: LeaveKind) {
    if (!window.confirm(`'${kind.name}' 신청 종류를 삭제할까요?`)) return
    setError(null)
    const { error: deleteError } = await supabase.from("leave_kinds").delete().eq("id", kind.id)
    if (deleteError) {
      setError(
        deleteError.code === "23503"
          ? "이미 사용된 종류는 삭제할 수 없습니다. 수정을 눌러 숨기면 새 신청에 나오지 않습니다."
          : humanError(new Error(deleteError.message)),
      )
      return
    }
    setKinds((rows) => rows.filter((row) => row.id !== kind.id))
  }

  return (
    <section className="mb-6 max-w-3xl">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">신청 종류</h2>
        <Button variant="ghost" onClick={openCreate}>
          추가
        </Button>
      </div>
      {error && !draft ? (
        <div className="mb-3">
          <Alert>{error}</Alert>
        </div>
      ) : null}
      {kinds.length === 0 ? <p className="text-xs text-muted">등록된 신청 종류가 없습니다.</p> : null}
      {kinds.length > 0 ? (
        <div className="ds-table is-compact">
          <table className="w-full text-left">
            <thead>
              <tr>
                <th>이름</th>
                <th>일수</th>
                <th>차감</th>
                <th>상태</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {kinds.map((kind) => (
                <tr key={kind.id}>
                  <td>{kind.name}</td>
                  <td>{formatLeaveDays(kind.minutes)}</td>
                  <td>{deductLabel(kind.deduct_type)}</td>
                  <td>{kind.enabled ? "사용" : "숨김"}</td>
                  <td>
                    <span className="inline-flex gap-2">
                      <Button variant="ghost" onClick={() => openEdit(kind)}>
                        수정
                      </Button>
                      <Button variant="danger" onClick={() => void remove(kind)}>
                        삭제
                      </Button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {draft ? (
        <Modal title={draft.id ? "신청 종류 수정" : "신청 종류 추가"} onClose={() => setDraft(null)}>
          {error ? (
            <div className="mb-3">
              <Alert>{error}</Alert>
            </div>
          ) : null}
          <form
            id="leave-kind-form"
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            <Field compact label="이름">
              <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="경조사휴가" />
            </Field>
            <Field compact label="일수" hint="1일, 0.5일, 0.25일 단위">
              <input value={draft.days} onChange={(event) => setDraft({ ...draft, days: event.target.value })} inputMode="decimal" />
            </Field>
            <Field compact label="차감">
              <select value={draft.deduct} onChange={(event) => setDraft({ ...draft, deduct: event.target.value as LeaveType | "" })}>
                <option value="annual">연차</option>
                <option value="comp">보상휴가</option>
                <option value="summer">여름휴가</option>
                <option value="">차감 없음</option>
              </select>
            </Field>
            <Field compact label="상태">
              <select
                value={draft.enabled ? "on" : "off"}
                onChange={(event) => setDraft({ ...draft, enabled: event.target.value === "on" })}
              >
                <option value="on">사용</option>
                <option value="off">숨김</option>
              </select>
            </Field>
          </form>
          <div className="mt-3">
            <Button type="submit" form="leave-kind-form" className="w-full" disabled={pending}>
              {pending ? "저장 중" : "저장"}
            </Button>
          </div>
        </Modal>
      ) : null}
    </section>
  )
}
