import { BrowserRouter } from "react-router-dom"
import { App } from "./App.tsx"
import { AuthProvider } from "./auth/AuthContext.tsx"
import { appBasePath } from "./lib/env.ts"

function restoreTheme() {
  if (typeof document === "undefined" || typeof localStorage === "undefined") return
  const storedTheme = localStorage.getItem("hr-theme")
  if (storedTheme === "soft" || storedTheme === "night") document.documentElement.dataset.theme = storedTheme
}

restoreTheme()

export function Root() {
  const basename = appBasePath()
  return (
    <BrowserRouter basename={basename || undefined}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  )
}
