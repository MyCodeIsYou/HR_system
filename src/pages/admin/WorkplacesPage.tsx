import { useEffect, useState, type FormEvent } from "react"
import { Link } from "react-router-dom"
import { useAuth } from "../../auth/AuthContext.tsx"
import { Alert, Button, Card, Empty, Field, Page } from "../../components/ui.tsx"
import { clockLabel, humanError, latePolicyLabel } from "../../lib/format.ts"
import { supabase } from "../../lib/supabase.ts"
import { workplaceColumns, type Workplace } from "../../types.ts"

export function WorkplacesPage() {
  const { organization, refresh } = useAuth()
  const [rows, setRows] = useState<Workplace[]>([])
  const [name, setName] = useState(organization?.name ?? "")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

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
    await refresh()
  }

  return (
    <Page
      title="사업장"
      description="사업장마다 NFC 주소가 다릅니다. 카드에는 그 주소만 적습니다."
      action={
        <Link to="/admin/workplaces/new" className="ds-button">
          사업장 추가
        </Link>
      }
    >
      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => void rename(event)}>
          <div className="min-w-64 flex-1">
            <Field label="조직 이름">
              <input value={name} onChange={(event) => setName(event.target.value)} required />
            </Field>
          </div>
          <Button type="submit" disabled={pending}>
            이름 저장
          </Button>
        </form>
      </Card>
      {error ? <div className="mb-4"><Alert>{humanError(new Error(error))}</Alert></div> : null}
      {rows.length === 0 ? <Empty>등록된 사업장이 없습니다.</Empty> : null}
      <div className="grid gap-3">
        {rows.map((workplace) => (
          <Link key={workplace.id} to={`/admin/workplaces/${workplace.id}`} className="block">
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{workplace.name}</h2>
                  <p className="mt-1 text-sm text-muted">{workplace.address || "주소 없음"}</p>
                </div>
                <p className="text-sm text-muted">
                  {clockLabel(workplace.work_start)}–{clockLabel(workplace.work_end)} · {latePolicyLabel(workplace.late_policy)}
                </p>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </Page>
  )
}
