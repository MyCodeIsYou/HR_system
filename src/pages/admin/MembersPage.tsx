import { useEffect, useState, type FormEvent } from "react"
import { Alert, Button, Card, Empty, Field, Page, Toast } from "../../components/ui.tsx"
import { adjustLeave, inviteMember } from "../../lib/api.ts"
import { daysToMinutes, formatMinutes, humanError } from "../../lib/format.ts"
import { supabase } from "../../lib/supabase.ts"
import type { LeaveBalance, LeaveType, Profile, Role, Workplace } from "../../types.ts"
import { workplaceColumns } from "../../types.ts"

type Member = Profile & { annual: number; comp: number }

export function MembersPage() {
  const [members, setMembers] = useState<Member[]>([])
  const [workplaces, setWorkplaces] = useState<Workplace[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [invite, setInvite] = useState({
    email: "",
    name: "",
    role: "employee" as Role,
    workplace_id: "",
    employee_number: "",
    hired_at: "",
    initial_annual_days: "0",
  })
  const [edit, setEdit] = useState({
    name: "",
    role: "employee" as Role,
    workplace_id: "",
    employee_number: "",
    hired_at: "",
  })
  const [leave, setLeave] = useState({ leaveType: "annual" as LeaveType, days: "", reason: "" })

  async function load() {
    const [memberResult, workplaceResult, balanceResult] = await Promise.all([
      supabase.from("profiles").select("id, organization_id, workplace_id, name, email, role, employee_number, hired_at, created_at").order("name"),
      supabase.from("workplaces").select(workplaceColumns).order("name"),
      supabase.from("leave_balance_sums").select("user_id, leave_type, balance_minutes"),
    ])
    if (memberResult.error) throw memberResult.error
    if (workplaceResult.error) throw workplaceResult.error
    if (balanceResult.error) throw balanceResult.error
    const balances = (balanceResult.data ?? []) as LeaveBalance[]
    setWorkplaces((workplaceResult.data ?? []) as Workplace[])
    setMembers(
      ((memberResult.data ?? []) as Profile[]).map((member) => ({
        ...member,
        annual: balances.find((row) => row.user_id === member.id && row.leave_type === "annual")?.balance_minutes ?? 0,
        comp: balances.find((row) => row.user_id === member.id && row.leave_type === "comp")?.balance_minutes ?? 0,
      })),
    )
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

  const current = members.find((member) => member.id === selected) ?? null

  useEffect(() => {
    if (!current) return
    setEdit({
      name: current.name,
      role: current.role,
      workplace_id: current.workplace_id ?? "",
      employee_number: current.employee_number ?? "",
      hired_at: current.hired_at ?? "",
    })
  }, [current?.id, current?.name, current?.role, current?.workplace_id, current?.employee_number, current?.hired_at])

  async function onInvite(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      await inviteMember({
        email: invite.email.trim(),
        name: invite.name.trim(),
        role: invite.role,
        workplace_id: invite.workplace_id || null,
        employee_number: invite.employee_number.trim() || null,
        hired_at: invite.hired_at || null,
        initial_annual_days: Number(invite.initial_annual_days),
      })
      setMessage("초대 메일을 보냈습니다.")
      setInvite({ ...invite, email: "", name: "", employee_number: "" })
      await load()
    } catch (caught) {
      setError(humanError(caught))
    } finally {
      setPending(false)
    }
  }

  async function onSave(event: FormEvent) {
    event.preventDefault()
    if (!current) return
    setPending(true)
    setError(null)
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        name: edit.name.trim(),
        role: edit.role,
        workplace_id: edit.workplace_id || null,
        employee_number: edit.employee_number.trim() || null,
        hired_at: edit.hired_at || null,
      })
      .eq("id", current.id)
    setPending(false)
    if (updateError) {
      setError(humanError(updateError))
      return
    }
    setMessage("구성원을 저장했습니다.")
    await load()
  }

  async function onLeave(event: FormEvent) {
    event.preventDefault()
    if (!current) return
    const minutes = daysToMinutes(Number(leave.days))
    if (!Number.isFinite(minutes) || minutes === 0) {
      setError("0이 아닌 일수를 입력하세요.")
      return
    }
    setPending(true)
    setError(null)
    try {
      await adjustLeave({ userId: current.id, leaveType: leave.leaveType, deltaMinutes: minutes, reason: leave.reason })
      setLeave({ ...leave, days: "", reason: "" })
      setMessage("휴가 원장에 반영했습니다.")
      await load()
    } catch (caught) {
      setError(humanError(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <Page title="구성원" description="초대와 초기 연차 지급, 역할과 소속, 이후 휴가 조정을 합니다. 연차 1일은 8시간입니다.">
      {error ? <div className="mb-4"><Alert>{error}</Alert></div> : null}
      {message ? <div className="mb-4"><Toast>{message}</Toast></div> : null}
      <Card>
        <h2 className="font-semibold">초대</h2>
        <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={(event) => void onInvite(event)}>
          <Field label="이메일">
            <input type="email" value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} required />
          </Field>
          <Field label="이름">
            <input value={invite.name} onChange={(event) => setInvite({ ...invite, name: event.target.value })} required />
          </Field>
          <Field label="역할">
            <select value={invite.role} onChange={(event) => setInvite({ ...invite, role: event.target.value as Role })}>
              <option value="employee">직원</option>
              <option value="admin">관리자</option>
            </select>
          </Field>
          <Field label="소속 사업장">
            <select value={invite.workplace_id} onChange={(event) => setInvite({ ...invite, workplace_id: event.target.value })}>
              <option value="">없음</option>
              {workplaces.map((workplace) => (
                <option key={workplace.id} value={workplace.id}>{workplace.name}</option>
              ))}
            </select>
          </Field>
          <Field label="사번">
            <input value={invite.employee_number} onChange={(event) => setInvite({ ...invite, employee_number: event.target.value })} />
          </Field>
          <Field label="입사일">
            <input type="date" value={invite.hired_at} onChange={(event) => setInvite({ ...invite, hired_at: event.target.value })} />
          </Field>
          <Field label="초기 연차(일)" hint="지급분은 휴가 원장에 남습니다.">
            <input
              inputMode="decimal"
              value={invite.initial_annual_days}
              onChange={(event) => setInvite({ ...invite, initial_annual_days: event.target.value })}
              required
            />
          </Field>
          <div className="flex items-end">
            <Button type="submit" disabled={pending}>초대 보내기</Button>
          </div>
        </form>
      </Card>

      <div className="ds-table mt-6">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">이름</th>
              <th className="px-4 py-3 font-medium">역할</th>
              <th className="px-4 py-3 font-medium">연차</th>
              <th className="px-4 py-3 font-medium">보상휴가</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id} className={member.id === selected ? "is-selected" : undefined}>
                <td className="px-4 py-3">
                  <p className="font-medium">{member.name}</p>
                  <p className="text-muted">{member.email}</p>
                </td>
                <td className="px-4 py-3">{member.role === "admin" ? "관리자" : "직원"}</td>
                <td className="px-4 py-3 tabular-nums">{formatMinutes(member.annual)}</td>
                <td className="px-4 py-3 tabular-nums">{formatMinutes(member.comp)}</td>
                <td className="px-4 py-3">
                  <button type="button" className="text-accent" onClick={() => setSelected(member.id)}>수정</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {members.length === 0 ? <Empty>구성원이 없습니다.</Empty> : null}
      </div>

      {current ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <Card>
            <h2 className="font-semibold">{current.name}</h2>
            <form className="mt-4 grid gap-4" onSubmit={(event) => void onSave(event)}>
              <Field label="이름">
                <input value={edit.name} onChange={(event) => setEdit({ ...edit, name: event.target.value })} required />
              </Field>
              <Field label="역할">
                <select value={edit.role} onChange={(event) => setEdit({ ...edit, role: event.target.value as Role })}>
                  <option value="employee">직원</option>
                  <option value="admin">관리자</option>
                </select>
              </Field>
              <Field label="소속 사업장">
                <select value={edit.workplace_id} onChange={(event) => setEdit({ ...edit, workplace_id: event.target.value })}>
                  <option value="">없음</option>
                  {workplaces.map((workplace) => (
                    <option key={workplace.id} value={workplace.id}>{workplace.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="사번">
                <input value={edit.employee_number} onChange={(event) => setEdit({ ...edit, employee_number: event.target.value })} />
              </Field>
              <Field label="입사일">
                <input type="date" value={edit.hired_at} onChange={(event) => setEdit({ ...edit, hired_at: event.target.value })} />
              </Field>
              <Button type="submit" disabled={pending}>저장</Button>
            </form>
          </Card>
          <Card>
            <h2 className="font-semibold">휴가 조정</h2>
            <form className="mt-4 grid gap-4" onSubmit={(event) => void onLeave(event)}>
              <Field label="종류">
                <select value={leave.leaveType} onChange={(event) => setLeave({ ...leave, leaveType: event.target.value as LeaveType })}>
                  <option value="annual">연차</option>
                  <option value="comp">보상휴가</option>
                </select>
              </Field>
              <Field label="일수" hint="0.5는 4시간입니다. 음수는 차감입니다.">
                <input inputMode="decimal" value={leave.days} onChange={(event) => setLeave({ ...leave, days: event.target.value })} required />
              </Field>
              <Field label="사유">
                <input value={leave.reason} onChange={(event) => setLeave({ ...leave, reason: event.target.value })} required />
              </Field>
              <Button type="submit" disabled={pending}>원장에 반영</Button>
            </form>
          </Card>
        </div>
      ) : null}
    </Page>
  )
}
