import { useEffect, useState, type FormEvent } from "react"
import { Alert, Button, Empty, Field, Modal, Page } from "../../components/ui.tsx"
import { addAttendanceEvent, voidAttendanceEvent } from "../../lib/api.ts"
import { eventLabel, formatDate, formatTime, humanError, oneName, penaltyLines, seoulDateTimeLocal, seoulLocalToIso, seoulToday } from "../../lib/format.ts"
import { supabase } from "../../lib/supabase.ts"
import type { Adjustment, AttendanceEvent, AttendanceResult, Profile, Workplace } from "../../types.ts"
import { workplaceColumns } from "../../types.ts"

export function AttendancePage() {
  const [events, setEvents] = useState<AttendanceEvent[]>([])
  const [adjustments, setAdjustments] = useState<Adjustment[]>([])
  const [members, setMembers] = useState<Profile[]>([])
  const [workplaces, setWorkplaces] = useState<Workplace[]>([])
  const [date, setDate] = useState(seoulToday())
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AttendanceResult | null>(null)
  const [pending, setPending] = useState(false)
  const [voidId, setVoidId] = useState<string | null>(null)
  const [voidNote, setVoidNote] = useState("")
  const [manualOpen, setManualOpen] = useState(false)
  const [form, setForm] = useState({
    userId: "",
    workplaceId: "",
    eventType: "in" as "in" | "out",
    occurredAt: seoulDateTimeLocal(),
    note: "",
  })

  async function load() {
    const [eventResult, memberResult, workplaceResult, adjustmentResult] = await Promise.all([
      supabase
        .from("attendance_events")
        .select("id, user_id, workplace_id, event_type, occurred_at, work_date, source, voided_at, profiles(name), workplaces(name)")
        .eq("work_date", date)
        .order("occurred_at", { ascending: false }),
      supabase.from("profiles").select("id, name, role, organization_id, workplace_id, email, employee_number, hired_at, created_at").order("name"),
      supabase.from("workplaces").select(workplaceColumns).order("name"),
      supabase
        .from("attendance_adjustments")
        .select("id, action, note, created_at, event_id, actor:profiles!attendance_adjustments_actor_id_fkey(name), subject:profiles!attendance_adjustments_user_id_fkey(name)")
        .order("created_at", { ascending: false })
        .limit(30),
    ])
    if (eventResult.error) throw eventResult.error
    if (memberResult.error) throw memberResult.error
    if (workplaceResult.error) throw workplaceResult.error
    if (adjustmentResult.error) throw adjustmentResult.error
    setEvents((eventResult.data ?? []) as AttendanceEvent[])
    setMembers((memberResult.data ?? []) as Profile[])
    setWorkplaces((workplaceResult.data ?? []) as Workplace[])
    setAdjustments((adjustmentResult.data ?? []) as Adjustment[])
  }

  useEffect(() => {
    let active = true
    void load().catch((caught: unknown) => {
      if (active) setError(humanError(caught))
    })
    return () => {
      active = false
    }
  }, [date])

  async function onAdd(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    setResult(null)
    try {
      const summary = await addAttendanceEvent({
        userId: form.userId,
        workplaceId: form.workplaceId,
        eventType: form.eventType,
        occurredAt: seoulLocalToIso(form.occurredAt),
        note: form.note,
      })
      setResult(summary)
      setForm({ ...form, note: "" })
      setManualOpen(false)
      await load()
    } catch (caught) {
      setError(humanError(caught))
    } finally {
      setPending(false)
    }
  }

  async function onVoid(event: FormEvent) {
    event.preventDefault()
    if (!voidId) return
    setPending(true)
    setError(null)
    try {
      await voidAttendanceEvent(voidId, voidNote)
      setVoidId(null)
      setVoidNote("")
      await load()
    } catch (caught) {
      setError(humanError(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <Page
      title="출퇴근"
      description="누락과 오기는 사유와 함께 더하거나 취소합니다. 취소하면 연차·보상휴가 원장도 되돌립니다. 연결된 퇴근이 있으면 퇴근을 먼저 취소하세요."
      action={<Button onClick={() => { setResult(null); setManualOpen(true) }}>수동 기록</Button>}
    >
      {error && !manualOpen && !voidId ? <div className="mb-4"><Alert>{error}</Alert></div> : null}
      {result ? <p className="mb-4 text-sm">{eventLabel(result.action)} {formatTime(result.occurred_at)} {penaltyLines(result).join(" · ")}</p> : null}
      {manualOpen ? (
        <Modal title="수동 기록" onClose={() => setManualOpen(false)}>
          <p className="mb-4 text-xs leading-5 text-muted">시각은 한국 시간으로 저장합니다. 출근 기록이 없는 퇴근은 야근을 계산하지 않습니다.</p>
          {error ? <div className="mb-3"><Alert>{error}</Alert></div> : null}
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => void onAdd(event)}>
            <Field compact label="구성원">
              <select value={form.userId} onChange={(event) => setForm({ ...form, userId: event.target.value })} required>
                <option value="">선택</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>{member.name}</option>
                ))}
              </select>
            </Field>
            <Field compact label="사업장">
              <select value={form.workplaceId} onChange={(event) => setForm({ ...form, workplaceId: event.target.value })} required>
                <option value="">선택</option>
                {workplaces.map((workplace) => (
                  <option key={workplace.id} value={workplace.id}>{workplace.name}</option>
                ))}
              </select>
            </Field>
            <Field compact label="구분">
              <select value={form.eventType} onChange={(event) => setForm({ ...form, eventType: event.target.value as "in" | "out" })}>
                <option value="in">출근</option>
                <option value="out">퇴근</option>
              </select>
            </Field>
            <Field compact label="시각">
              <input type="datetime-local" value={form.occurredAt} onChange={(event) => setForm({ ...form, occurredAt: event.target.value })} required />
            </Field>
            <div className="flex items-end gap-2 sm:col-span-2">
              <div className="min-w-0 flex-1">
                <Field compact label="사유">
                  <input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} required />
                </Field>
              </div>
              <Button type="submit" disabled={pending}>{pending ? "기록 중" : "기록"}</Button>
            </div>
          </form>
        </Modal>
      ) : null}

      <div className="mt-4 w-40">
        <Field compact label="근무일">
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
      </div>

      <div className="ds-table is-compact mt-3 max-w-3xl">
        <table className="w-full text-left">
          <thead className="text-muted">
            <tr>
              <th className="font-medium">구성원</th>
              <th className="font-medium">구분</th>
              <th className="font-medium">시각</th>
              <th className="font-medium">사업장</th>
              <th className="font-medium">출처</th>
              <th className="font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {events.map((row) => (
              <tr key={row.id}>
                <td>{oneName(row.profiles)}</td>
                <td className={row.voided_at ? "text-muted line-through" : ""}>{eventLabel(row.event_type)}</td>
                <td className="tabular-nums">{formatTime(row.occurred_at)}</td>
                <td>{oneName(row.workplaces)}</td>
                <td>{row.source === "nfc" ? "NFC" : "수동"}</td>
                <td>
                  {row.voided_at ? "취소됨" : (
                    <button type="button" className="text-danger" onClick={() => setVoidId(row.id)}>취소</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {events.length === 0 ? <Empty>이 날짜의 기록이 없습니다.</Empty> : null}
      </div>

      {voidId ? (
        <Modal title="기록 취소" onClose={() => setVoidId(null)}>
          {error ? <div className="mb-3"><Alert>{error}</Alert></div> : null}
          <form className="grid gap-3" onSubmit={(event) => void onVoid(event)}>
            <Field compact label="취소 사유">
              <input value={voidNote} onChange={(event) => setVoidNote(event.target.value)} required />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" variant="danger" disabled={pending}>취소 확정</Button>
              <Button variant="ghost" onClick={() => setVoidId(null)}>닫기</Button>
            </div>
          </form>
        </Modal>
      ) : null}

      <h2 className="mt-5 mb-2 text-sm font-semibold">보정 이력</h2>
      {adjustments.length === 0 ? <p className="text-xs text-muted">보정 이력이 없습니다.</p> : null}
      {adjustments.length > 0 ? (
        <div className="ds-table is-compact max-w-3xl">
          <table className="w-full text-left">
            <thead className="text-muted">
              <tr>
                <th className="font-medium">처리</th>
                <th className="font-medium">대상</th>
                <th className="font-medium">구분</th>
                <th className="font-medium">시각</th>
                <th className="font-medium">사유</th>
              </tr>
            </thead>
            <tbody>
              {adjustments.map((row) => (
                <tr key={row.id}>
                  <td>{oneName(row.actor)}</td>
                  <td>{oneName(row.subject)}</td>
                  <td>{row.action === "add_event" ? "기록 추가" : "기록 취소"}</td>
                  <td className="tabular-nums">{formatDate(row.created_at)} {formatTime(row.created_at)}</td>
                  <td>{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Page>
  )
}
