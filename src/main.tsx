import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { App } from "./App.tsx"
import { AuthProvider } from "./auth/AuthContext.tsx"
import cafe24 from "./assets/fonts/Cafe24Ssurround.woff?url"
import "./index.css"

const rounded = document.createElement("style")
rounded.textContent = `@font-face{font-family:"Cafe24 Ssurround";src:url("${cafe24}") format("woff");font-weight:400;font-style:normal;font-display:swap}@font-face{font-family:"Cafe24 Ssurround";src:url("${cafe24}") format("woff");font-weight:700;font-style:normal;font-display:swap}`
document.head.appendChild(rounded)

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
