"use dom"

import { StrictMode } from "react"
import { Root } from "./Root.tsx"
import "./index.css"

export default function WebApp(props: { dom?: { style?: object; scrollEnabled?: boolean }; entryPath?: string; entrySeq?: number }) {
  void props.dom
  return (
    <StrictMode>
      <Root entryPath={props.entryPath ?? ""} entrySeq={props.entrySeq ?? 0} />
    </StrictMode>
  )
}
