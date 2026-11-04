import type { Session } from "@supabase/supabase-js"
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import type { Organization, Profile, UiTheme } from "../types.ts"
import { supabase, isSupabaseConfigured } from "../lib/supabase.ts"

type AuthValue = {
  ready: boolean
  configured: boolean
  session: Session | null
  profile: Profile | null
  organization: Organization | null
  profileError: string | null
  refresh: () => Promise<void>
  signOut: () => Promise<void>
  setTheme: (theme: UiTheme) => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

const profileColumns = "id, organization_id, workplace_id, name, email, role, job_title, employee_number, hired_at, ui_theme, created_at"

export function applyTheme(theme: UiTheme) {
  document.documentElement.dataset.theme = theme
  localStorage.setItem("hr-theme", theme)
}

async function loadAccount(userId: string): Promise<{ profile: Profile | null; organization: Organization | null }> {
  let profile: Profile | null = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data, error } = await supabase.from("profiles").select(profileColumns).eq("id", userId).maybeSingle()
    if (error) throw new Error(error.message)
    profile = data as Profile | null
    if (profile || attempt === 1) break
    await new Promise((resolve) => setTimeout(resolve, 400))
  }

  if (!profile?.organization_id) return { profile, organization: null }
  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, leave_entry_mode, leave_digest_emails")
    .eq("id", profile.organization_id)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return { profile, organization: data as Organization | null }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(!isSupabaseConfigured)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [profileReady, setProfileReady] = useState(!isSupabaseConfigured)
  const [profileError, setProfileError] = useState<string | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let active = true
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setReady(true)
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!session) return
    setProfileError(null)
    const account = await loadAccount(session.user.id)
    setProfile(account.profile)
    setOrganization(account.organization)
  }, [session])

  useEffect(() => {
    if (!ready) return
    if (!session) {
      setProfile(null)
      setOrganization(null)
      setProfileError(null)
      setProfileReady(true)
      return
    }
    let active = true
    setProfileReady(false)
    void loadAccount(session.user.id)
      .then((account) => {
        if (!active) return
        setProfile(account.profile)
        setOrganization(account.organization)
        if (account.profile?.ui_theme) applyTheme(account.profile.ui_theme)
        setProfileError(null)
        setProfileReady(true)
      })
      .catch((error: unknown) => {
        if (!active) return
        setProfile(null)
        setOrganization(null)
        setProfileError(error instanceof Error ? error.message : "프로필을 불러오지 못했습니다.")
        setProfileReady(true)
      })
    return () => {
      active = false
    }
  }, [ready, session])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const setTheme = useCallback(
    async (theme: UiTheme) => {
      const previous = profile?.ui_theme ?? "night"
      applyTheme(theme)
      if (!profile) return
      const { error } = await supabase.from("profiles").update({ ui_theme: theme }).eq("id", profile.id)
      if (error) {
        applyTheme(previous)
        return
      }
      setProfile({ ...profile, ui_theme: theme })
    },
    [profile],
  )

  const value = useMemo<AuthValue>(
    () => ({
      ready: ready && profileReady,
      configured: isSupabaseConfigured,
      session,
      profile,
      organization,
      profileError,
      refresh,
      signOut,
      setTheme,
    }),
    [ready, profileReady, session, profile, organization, profileError, refresh, signOut, setTheme],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error("인증 정보가 없습니다.")
  return value
}
