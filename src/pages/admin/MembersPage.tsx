import { useEffect, useState, type FormEvent } from "react"
import { Alert, Button, Empty, Field, Modal, Page, Toast } from "../../components/ui.tsx"
import { adjustLeave, inviteMember } from "../../lib/api.ts"
import { formatLeaveDays, humanError, leaveDayValue, leaveTypeLabel, parseLeaveDays } from "../../lib/format.ts"
import { supabase } from "../../lib/supabase.ts"
import type { LeaveBalance, LeaveType, Profile, Role, Workplace } from "../../types.ts"
import { workplaceColumns } from "../../types.ts"

type Member = Profile & { annual: number; comp: number; summer: number }

export function MembersPage() {
  const [members, setMembers] = useState<Member[]>([])
  const [workplaces, setWorkplaces] = useState<Workplace[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [invite, setInvite] = useState({
    email: "",
    name: "",
    role: "employee" as Role,
    workplace_id: "",
    job_title: "",
    employee_number: "",
    hired_at: "",
    initial_annual_days: "0",
  })
  const [edit, setEdit] = useState({
    name: "",
    role: "employee" as Role,
    workplace_id: "",
    job_title: "",
    employee_number: "",
    hired_at: "",
  })
  const [leaveDays, setLeaveDays] = useState({ annual: "0", comp: "0", summer: "0" })

  async function load() {
    const [memberResult, workplaceResult, balanceResult] = await Promise.all([
      supabase.from("profiles").select("id, organization_id, workplace_id, name, email, role, job_title, employee_number, hired_at, created_at").order("name"),
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
        summer: balances.find((row) => row.user_id === member.id && row.leave_type === "summer")?.balance_minutes ?? 0,
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
      job_title: current.job_title ?? "",
      employee_number: current.employee_number ?? "",
      hired_at: current.hired_at ?? "",
    })
    setLeaveDays({
      annual: leaveDayValue(current.annual),
      comp: leaveDayValue(current.comp),
      summer: leaveDayValue(current.summer),
    })
  }, [current?.id, current?.name, current?.role, current?.workplace_id, current?.job_title, current?.employee_number, current?.hired_at, current?.annual, current?.comp, current?.summer])

  async function onInvite(event: FormEvent) {
    event.preventDefault()
    const parsed = parseLeaveDays(invite.initial_annual_days)
    if ("error" in parsed || parsed.minutes < 0) {
      setError("error" in parsed ? parsed.error : "초기 연차는 0일 이상으로 입력하세요.")
      return
    }
    setPending(true)
    setError(null)
    setMessage(null)
    try {
      await inviteMember({
        email: invite.email.trim(),
        name: invite.name.trim(),
        role: invite.role,
        workplace_id: invite.workplace_id || null,
        job_title: invite.job_title.trim() || null,
        employee_number: invite.employee_number.trim() || null,
        hired_at: invite.hired_at || null,
        initial_annual_days: parsed.minutes / 480,
      })
      setMessage("초대 메일을 보냈습니다. 초기 비밀번호는 없고, 메일 링크에서 본인이 정합니다.")
      setInvite({ ...invite, email: "", name: "", job_title: "", employee_number: "" })
      setInviteOpen(false)
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
    const leaveChanges: { type: LeaveType; delta: number }[] = []
    for (const type of ["annual", "comp", "summer"] as const) {
      const parsed = parseLeaveDays(leaveDays[type])
      if ("error" in parsed) {
        setError(parsed.error)
        return
      }
      const currentMinutes = type === "annual" ? current.annual : type === "comp" ? current.comp : current.summer
      const delta = parsed.minutes - currentMinutes
      if (delta !== 0) leaveChanges.push({ type, delta })
    }
    setPending(true)
    setError(null)
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        name: edit.name.trim(),
        role: edit.role,
        workplace_id: edit.workplace_id || null,
        job_title: edit.job_title.trim() || null,
        employee_number: edit.employee_number.trim() || null,
        hired_at: edit.hired_at || null,
      })
      .eq("id", current.id)
    if (updateError) {
      setPending(false)
      setError(humanError(updateError))
      return
    }
    try {
      for (const change of leaveChanges) {
        await adjustLeave({
          userId: current.id,
          leaveType: change.type,
          deltaMinutes: change.delta,
          reason: `${leaveTypeLabel(change.type)} 수정`,
        })
      }
    } catch (caught) {
      setPending(false)
      setError(humanError(caught))
      return
    }
    setPending(false)
    setMessage("구성원을 저장했습니다.")
    setSelected(null)
    await load()
  }

  return (
    <Page
      title="구성원"
      description="초대와 초기 연차 지급, 역할과 소속, 이후 휴가 조정을 합니다. 연차 1일은 8시간입니다."
      action={<Button onClick={() => { setError(null); setInviteOpen(true) }}>초대</Button>}
    >
      {error && !inviteOpen && !current ? <div className="mb-4"><Alert>{error}</Alert></div> : null}
      {message ? <div className="mb-4"><Toast>{message}</Toast></div> : null}
      {inviteOpen ? (
        <Modal
          title="초대"
          onClose={() => setInviteOpen(false)}
          footer={
            <Button type="submit" form="invite-member" className="w-full" disabled={pending}>
              {pending ? "보내는 중" : "초대 보내기"}
            </Button>
          }
        >
          {error ? <div className="mb-3"><Alert>{error}</Alert></div> : null}
          <p className="mb-3 text-sm leading-6 text-muted">초기 비밀번호는 없습니다. 초대 메일의 링크에서 본인이 정합니다.</p>
          <form id="invite-member" className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => void onInvite(event)}>
            <Field compact label="이메일">
              <input type="email" value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} required />
            </Field>
            <Field compact label="이름">
              <input value={invite.name} onChange={(event) => setInvite({ ...invite, name: event.target.value })} required />
            </Field>
            <Field compact label="직책">
              <input value={invite.job_title} onChange={(event) => setInvite({ ...invite, job_title: event.target.value })} placeholder="팀장" />
            </Field>
            <Field compact label="역할">
              <select value={invite.role} onChange={(event) => setInvite({ ...invite, role: event.target.value as Role })}>
                <option value="employee">직원</option>
                <option value="admin">관리자</option>
              </select>
            </Field>
            <Field compact label="소속 사업장">
              <select value={invite.workplace_id} onChange={(event) => setInvite({ ...invite, workplace_id: event.target.value })}>
                <option value="">없음</option>
                {workplaces.map((workplace) => (
                  <option key={workplace.id} value={workplace.id}>{workplace.name}</option>
                ))}
              </select>
            </Field>
            <Field compact label="사번">
              <input value={invite.employee_number} onChange={(event) => setInvite({ ...invite, employee_number: event.target.value })} />
            </Field>
            <Field compact label="입사일">
              <input type="date" value={invite.hired_at} onChange={(event) => setInvite({ ...invite, hired_at: event.target.value })} />
            </Field>
            <Field compact label="초기 연차(일)" hint="연차 1, 반차 0.5, 반반차 0.25. 지급분은 휴가 원장에 남습니다.">
              <input
                inputMode="decimal"
                value={invite.initial_annual_days}
                onChange={(event) => setInvite({ ...invite, initial_annual_days: event.target.value })}
                required
              />
            </Field>
          </form>
        </Modal>
      ) : null}

      <div className="ds-table is-compact is-center max-w-3xl">
        <table className="w-full">
          <thead className="text-muted">
            <tr>
              <th className="font-medium">이름</th>
              <th className="font-medium">연차</th>
              <th className="font-medium">보상휴가</th>
              <th className="font-medium">여름휴가</th>
              <th className="font-medium">남은 휴가</th>
              <th className="font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id} className={member.id === selected ? "is-selected" : undefined}>
                <td className="font-medium">{member.name}</td>
                <td className="tabular-nums">{formatLeaveDays(member.annual)}</td>
                <td className="tabular-nums">{formatLeaveDays(member.comp)}</td>
                <td className="tabular-nums">{formatLeaveDays(member.summer)}</td>
                <td className="tabular-nums">{formatLeaveDays(member.annual + member.comp + member.summer)}</td>
                <td>
                  <button type="button" className="ds-icon-button is-sm" aria-label="수정" onClick={() => setSelected(member.id)}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M15.2 3.8a2.1 2.1 0 0 1 3 3L8.2 16.8 4.5 17.5l.7-3.7Z" />
                      <path d="M13.4 5.6l3 3" />
                    </svg>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {members.length === 0 ? <Empty>구성원이 없습니다.</Empty> : null}
      </div>

      {current ? (
        <Modal title={current.name} onClose={() => setSelected(null)}>
          {error ? <div className="mb-3"><Alert>{error}</Alert></div> : null}
          <form className="grid grid-cols-2 gap-3" onSubmit={(event) => void onSave(event)}>
            <Field compact label="이름">
              <input value={edit.name} onChange={(event) => setEdit({ ...edit, name: event.target.value })} required />
            </Field>
            <Field compact label="직책">
              <input value={edit.job_title} onChange={(event) => setEdit({ ...edit, job_title: event.target.value })} placeholder="팀장" />
            </Field>
            <Field compact label="역할">
              <select value={edit.role} onChange={(event) => setEdit({ ...edit, role: event.target.value as Role })}>
                <option value="employee">직원</option>
                <option value="admin">관리자</option>
              </select>
            </Field>
            <Field compact label="소속 사업장">
              <select value={edit.workplace_id} onChange={(event) => setEdit({ ...edit, workplace_id: event.target.value })}>
                <option value="">없음</option>
                {workplaces.map((workplace) => (
                  <option key={workplace.id} value={workplace.id}>{workplace.name}</option>
                ))}
              </select>
            </Field>
            <Field compact label="사번">
              <input value={edit.employee_number} onChange={(event) => setEdit({ ...edit, employee_number: event.target.value })} />
            </Field>
            <Field compact label="입사일">
              <input type="date" value={edit.hired_at} onChange={(event) => setEdit({ ...edit, hired_at: event.target.value })} />
            </Field>
            <Field compact label="연차" hint="1, 0.5, 0.25">
              <input inputMode="decimal" value={leaveDays.annual} onChange={(event) => setLeaveDays({ ...leaveDays, annual: event.target.value })} required />
            </Field>
            <Field compact label="보상휴가" hint="1, 0.5, 0.25">
              <input inputMode="decimal" value={leaveDays.comp} onChange={(event) => setLeaveDays({ ...leaveDays, comp: event.target.value })} required />
            </Field>
            <Field compact label="여름휴가" hint="1, 0.5, 0.25">
              <input inputMode="decimal" value={leaveDays.summer} onChange={(event) => setLeaveDays({ ...leaveDays, summer: event.target.value })} required />
            </Field>
            <div className="flex items-end">
              <Button type="submit" disabled={pending}>{pending ? "저장 중" : "저장"}</Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </Page>
  )
}
