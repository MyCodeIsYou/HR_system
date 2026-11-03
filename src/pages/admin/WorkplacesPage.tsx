import { useEffect, useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import { useAuth } from "../../auth/AuthContext.tsx"
import { Alert, Button, Empty, Field, Modal, Page } from "../../components/ui.tsx"
import { clockLabel, humanError, latePolicyLabel } from "../../lib/format.ts"
import { supabase } from "../../lib/supabase.ts"
import { workplaceColumns, type Workplace } from "../../types.ts"

export function WorkplacesPage() {
  const { organization, refresh } = useAuth()
  const [rows, setRows] = useState<Workplace[]>([])
  const [name, setName] = useState(organization?.name ?? "")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)

  useEffect(() => {
    setName(organization?.name ?? "")
  }, [organization?.name])

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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Page>
  )
}
