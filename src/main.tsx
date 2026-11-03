import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { App } from "./App.tsx"
import { AuthProvider } from "./auth/AuthContext.tsx"
import "./index.css"

const root = document.getElementById("root")
if (!root) throw new Error("루트 요소가 없습니다.")

const basename = import.meta.env.BASE_URL.replace(/\/$/, "")

createRoot(root).render(
  <StrictMode>
    <BrowserRouter basename={basename || undefined}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
