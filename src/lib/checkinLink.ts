import { appBasePath } from "./env.ts"

const publicSite = "https://mycodeisyou.github.io/HR_system"

export function webCheckinUrl(token: string): string {
  if (typeof window !== "undefined" && window.location.protocol.startsWith("http") && window.location.hostname !== "appassets.androidplatform.net") {
    return `${window.location.origin}${appBasePath()}/c/${token}`
  }
  return `${publicSite}/c/${token}`
}

export function appCheckinUrl(token: string): string {
  return `hrsystem://c/${token}`
}

export function checkinPathFromUrl(url: string | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    const path = parsed.protocol === "hrsystem:"
      ? `/${parsed.hostname}${parsed.pathname}`.replace(/\/{2,}/g, "/")
      : parsed.pathname
    const match = path.match(/\/c\/([0-9a-fA-F]+)\/?$/)
    if (!match) return null
    return `/c/${match[1]}`
  } catch {
    return null
  }
}
