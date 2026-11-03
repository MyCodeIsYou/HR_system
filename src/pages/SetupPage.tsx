import { useEffect, useState, type FormEvent } from "react"
import { Navigate } from "react-router-dom"
import { useAuth } from "../auth/AuthContext.tsx"
import { Alert, Button, Card, Field, FullScreen } from "../components/ui.tsx"
import { bootstrapOrganization, organizationExists } from "../lib/api.ts"
import { humanError } from "../lib/format.ts"

export function SetupPage() {
  const { configured, ready, session, profile, refresh, signOut } = useAuth()
  const [exists, setExists] = useState<boolean | null>(null)
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!session || profile?.organization_id) return
    let active = true
    void organizationExists()
      .then((value) => {
        if (active) setExists(value)
      })
      .catch((caught: unknown) => {
        if (active) setError(humanError(caught))
      })
    return () => {
      active = false
    }
  }, [session, profile?.organization_id])

  if (!configured) return null
  if (!ready) return <FullScreen title="불러오는 중" />
  if (!session) return <Navigate to="/login?next=/setup" replace />
  if (profile?.organization_id) return <Navigate to="/" replace />

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    try {
      await bootstrapOrganization(name)
      await refresh()
    } catch (caught) {
      setError(humanError(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="grid min-h-svh place-items-center px-4 py-10">
      <Card className="w-full max-w-md">
        <p className="text-xs tracking-[0.18em] text-accent">근태</p>
        <h1 className="mt-2 text-2xl font-semibold">조직 준비</h1>
        {exists === null && !error ? <p className="mt-4 text-sm text-muted">확인하는 중</p> : null}
        {exists === false ? (
          <form className="mt-6 space-y-4" onSubmit={(event) => void onSubmit(event)}>
            <Field label="조직 이름" hint="첫 계정은 이 조직의 관리자가 됩니다.">
              <input value={name} onChange={(event) => setName(event.target.value)} required />
            </Field>
            {error ? <Alert>{error}</Alert> : null}
            <Button type="submit" disabled={pending}>
              {pending ? "만드는 중" : "조직 만들기"}
            </Button>
          </form>
        ) : null}
        {exists === true ? (
          <div className="mt-4 space-y-4">
            <p className="text-sm leading-6 text-muted">
              이미 조직이 있습니다. 관리자에게 초대를 요청한 뒤, 초대 메일로 들어오세요.
            </p>
            {error ? <Alert>{error}</Alert> : null}
          </div>
        ) : null}
        {exists !== false && error ? <div className="mt-4"><Alert>{error}</Alert></div> : null}
        <button type="button" className="mt-6 text-sm text-muted underline-offset-4 hover:underline" onClick={() => void signOut()}>
          로그아웃
        </button>
      </Card>
    </main>
  )
}
