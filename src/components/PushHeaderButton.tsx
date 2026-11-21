import { useEffect, useState } from "react"
import { useAuth } from "../auth/AuthContext.tsx"
import { humanError } from "../lib/format.ts"
import { currentPushSubscription, disablePush, enablePush, pushSupported } from "../lib/push.ts"
import { Button } from "./ui.tsx"

export function PushHeaderButton() {
  const { profile, organization } = useAuth()
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    void currentPushSubscription().then((subscription) => {
      if (active) setOn(Boolean(subscription))
    })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!note) return
    const timer = window.setTimeout(() => setNote(null), 3200)
    return () => window.clearTimeout(timer)
  }, [note])

  async function toggle() {
    if (!profile?.id || !organization) return
    setBusy(true)
    setNote(null)
    try {
      if (on) {
        await disablePush(profile.id)
        setOn(false)
        setFailed(false)
        setNote("이 기기의 알림을 껐습니다.")
      } else {
        await enablePush(profile.id, organization.id)
        setOn(true)
        setFailed(false)
        setNote("이 기기의 알림을 켰습니다.")
      }
    } catch (caught) {
      setFailed(true)
      setNote(humanError(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ds-push">
      <Button className="ds-push-toggle" variant={on ? "ghost" : "primary"} disabled={busy || !pushSupported()} onClick={() => void toggle()}>
        {busy ? "저장 중" : on ? "알림 끄기" : "알림 켜기"}
      </Button>
      {note ? (
        <p className={failed ? "ds-push-note is-error" : "ds-push-note"} role="status">
          {note}
        </p>
      ) : null}
    </div>
  )
}
