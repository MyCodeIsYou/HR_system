import { useEffect, useRef } from "react"
import { BrowserRouter, useNavigate } from "react-router-dom"
import { App } from "./App.tsx"
import { AuthProvider } from "./auth/AuthContext.tsx"
import { appBasePath } from "./lib/env.ts"

function restoreTheme() {
  if (typeof document === "undefined" || typeof localStorage === "undefined") return
  const storedTheme = localStorage.getItem("hr-theme")
  if (storedTheme === "soft" || storedTheme === "night") document.documentElement.dataset.theme = storedTheme
}

restoreTheme()

function AppEntry({ path, seq }: { path: string; seq: number }) {
  const navigate = useNavigate()
  const seen = useRef(0)

  useEffect(() => {
    if (!path || seq === 0 || seen.current === seq) return
    seen.current = seq
    const token = path.slice("/c/".length)
    try {
      sessionStorage.removeItem("hr-nfc-lock")
    } catch {
      // The app web view can block storage. The route still opens.
    }
    navigate(`/c/${token}`, { replace: true, state: { tap: seq } })
  }, [path, seq, navigate])

  return null
}

export function Root({ entryPath = "", entrySeq = 0 }: { entryPath?: string; entrySeq?: number }) {
  const basename = appBasePath()
  return (
    <BrowserRouter basename={basename || undefined}>
      <AppEntry path={entryPath} seq={entrySeq} />
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  )
}
