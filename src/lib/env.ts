function defined(value: string | undefined): string {
  return typeof value === "string" ? value : ""
}

export function supabaseUrl(): string {
  const expo = typeof process !== "undefined" ? defined(process.env.EXPO_PUBLIC_SUPABASE_URL) : ""
  if (expo) return expo
  return defined(import.meta.env?.EXPO_PUBLIC_SUPABASE_URL) || defined(import.meta.env?.VITE_SUPABASE_URL)
}

export function supabaseAnonKey(): string {
  const expo = typeof process !== "undefined" ? defined(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) : ""
  if (expo) return expo
  return defined(import.meta.env?.EXPO_PUBLIC_SUPABASE_ANON_KEY) || defined(import.meta.env?.VITE_SUPABASE_ANON_KEY)
}

export function appBasePath(): string {
  const base = import.meta.env?.BASE_URL
  if (typeof base !== "string") return ""
  return base.replace(/\/$/, "")
}
