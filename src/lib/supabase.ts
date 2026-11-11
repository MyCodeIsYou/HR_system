import { createClient } from "@supabase/supabase-js"
import { supabaseAnonKey, supabaseUrl } from "./env.ts"

const url = supabaseUrl()
const anonKey = supabaseAnonKey()
const passwordSetupKey = "hr-password-setup"

function capturePasswordSetup() {
  if (typeof window === "undefined") return
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""))
  const query = new URLSearchParams(window.location.search)
  const type = hash.get("type") ?? query.get("type")
  if (type === "invite" || type === "recovery") sessionStorage.setItem(passwordSetupKey, type)
}

capturePasswordSetup()

export function pendingPasswordSetup(): "invite" | "recovery" | null {
  if (typeof window === "undefined") return null
  const type = sessionStorage.getItem(passwordSetupKey)
  return type === "invite" || type === "recovery" ? type : null
}

export function clearPasswordSetup() {
  sessionStorage.removeItem(passwordSetupKey)
}

export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabase = createClient(url || "http://127.0.0.1:54321", anonKey || "missing-anon-key", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
