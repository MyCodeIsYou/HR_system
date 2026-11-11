import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Root } from "./Root.tsx"
import "./index.css"

const root = document.getElementById("root")
if (!root) throw new Error("루트 요소가 없습니다.")

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
