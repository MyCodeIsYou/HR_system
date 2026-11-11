import { useState, type FormEvent } from "react"
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom"
import { useAuth } from "../auth/AuthContext.tsx"
import { Button, Card, Field, FullScreen, Toast } from "../components/ui.tsx"
import { appBasePath } from "../lib/env.ts"
import { humanError, safeNext } from "../lib/format.ts"
import { clearPasswordSetup, pendingPasswordSetup, supabase } from "../lib/supabase.ts"

export function LoginPage() {
  const { configured, ready, session } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const next = safeNext(params.get("next"))
  const [mode, setMode] = useState<"login" | "signup">("login")
  const [setupKind, setSetupKind] = useState<"invite" | "recovery" | null>(() => pendingPasswordSetup())
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  if (!configured) return null
  if (!ready) return <FullScreen title="불러오는 중" />

  function loginRedirectUrl() {
    const base = appBasePath()
    return new URL("login", `${window.location.origin}${base}/`).toString()
  }

  async function onSetPassword(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (password !== confirm) {
      setError("비밀번호가 서로 다릅니다.")
      return
    }
    setPending(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError
      clearPasswordSetup()
      setSetupKind(null)
      navigate(next, { replace: true })
    } catch (caught) {
      setError(humanError(caught))
    } finally {
      setPending(false)
    }
  }

  async function onRequestSetup() {
    setError(null)
    setInfo(null)
    const target = email.trim()
    if (!target.includes("@")) {
      setError("비밀번호 설정 메일을 받을 이메일을 입력하세요.")
      return
    }
    setPending(true)
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(target, { redirectTo: loginRedirectUrl() })
      if (resetError) throw resetError
      setInfo("비밀번호 설정 메일을 보냈습니다. 메일의 링크에서 비밀번호를 정하세요.")
    } catch (caught) {
      setError(humanError(caught))
    } finally {
      setPending(false)
    }
  }

  if (setupKind && !session) {
    return (
      <main className="grid min-h-svh place-items-center px-4 py-10">
        <Card className="w-full max-w-md">
          <p className="text-xs tracking-[0.18em] text-accent">근태</p>
          <h1 className="mt-2 text-2xl font-semibold">링크가 만료되었습니다</h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            초대 링크를 다시 열 수 없습니다. 이메일로 비밀번호 설정 메일을 다시 받으세요.
          </p>
          <form
            className="mt-6 space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void onRequestSetup()
            }}
          >
            <Field label="이메일">
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" />
            </Field>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            {info ? <Toast>{info}</Toast> : null}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "보내는 중" : "비밀번호 설정 메일 받기"}
            </Button>
          </form>
          <button
            type="button"
            className="mt-4 text-sm text-muted underline-offset-4 hover:underline"
            onClick={() => {
              clearPasswordSetup()
              setSetupKind(null)
            }}
          >
            로그인으로 돌아가기
          </button>
        </Card>
      </main>
    )
  }

  if (setupKind && session) {
    return (
      <main className="grid min-h-svh place-items-center px-4 py-10">
        <Card className="w-full max-w-md">
          <p className="text-xs tracking-[0.18em] text-accent">근태</p>
          <h1 className="mt-2 text-2xl font-semibold">비밀번호 설정</h1>
          <p className="mt-2 text-sm leading-6 text-muted">
            {setupKind === "invite"
              ? "초대 메일으로 들어오셨습니다. 앞으로 로그인할 비밀번호를 정하세요."
              : "새 비밀번호를 정하세요. 정한 뒤 그 비밀번호로 로그인합니다."}
          </p>
          <form className="mt-6 space-y-4" onSubmit={(event) => void onSetPassword(event)}>
            <Field label="비밀번호">
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </Field>
            <Field label="비밀번호 확인">
              <input
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </Field>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "저장 중" : "비밀번호 저장"}
            </Button>
          </form>
        </Card>
      </main>
    )
  }

  if (session) return <Navigate to={next} replace />

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setInfo(null)
    setPending(true)
    try {
      if (mode === "signup") {
        const { data, error: signError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { name: name.trim() } },
        })
        if (signError) throw signError
        if (!data.session) {
          setInfo("가입 메일을 확인한 뒤 로그인해 주세요.")
          setMode("login")
          return
        }
      } else {
        const { error: signError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        if (signError) throw signError
      }
      navigate(next, { replace: true })
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
        <h1 className="mt-2 text-2xl font-semibold">{mode === "login" ? "로그인" : "관리자 가입"}</h1>
        <p className="mt-2 text-sm leading-6 text-muted">
          처음 만드는 계정이 조직을 등록합니다. 직원은 초대 메일의 링크로 비밀번호를 만든 뒤 로그인합니다.
        </p>
        <form className="mt-6 space-y-4" onSubmit={(event) => void onSubmit(event)}>
          {mode === "signup" ? (
            <Field label="이름">
              <input value={name} onChange={(event) => setName(event.target.value)} required autoComplete="name" />
            </Field>
          ) : null}
          <Field label="이메일">
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="email"
            />
          </Field>
          <Field label="비밀번호">
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={6}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </Field>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
          {info ? <Toast>{info}</Toast> : null}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "처리 중" : mode === "login" ? "로그인" : "가입하기"}
          </Button>
        </form>
        <button
          type="button"
          className="mt-4 text-sm text-muted underline-offset-4 hover:underline"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login")
            setError(null)
            setInfo(null)
          }}
        >
          {mode === "login" ? "조직이 없다면 가입" : "이미 계정이 있습니다"}
        </button>
        {mode === "login" ? (
          <button
            type="button"
            className="mt-3 block text-sm text-muted underline-offset-4 hover:underline"
            disabled={pending}
            onClick={() => void onRequestSetup()}
          >
            비밀번호 설정 메일 받기
          </button>
        ) : null}
        <p className="mt-6 text-xs leading-5 text-muted">
          출퇴근 태그를 찍은 뒤 이 화면이 열렸다면, 로그인 후 같은 주소로 돌아가 기록됩니다.
        </p>
        <Link to="/" className="sr-only">
          내 근태
        </Link>
      </Card>
    </main>
  )
}
