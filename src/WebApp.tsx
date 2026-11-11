"use dom"

import { StrictMode } from "react"
import { Root } from "./Root.tsx"
import "./index.css"

export default function WebApp(props: { dom?: { style?: object; scrollEnabled?: boolean } }) {
  void props.dom
  return (
    <StrictMode>
      <Root />
    </StrictMode>
  )
}
