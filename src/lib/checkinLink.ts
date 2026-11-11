const publicSite = "https://mycodeisyou.github.io/HR_system"

export function webCheckinUrl(token: string): string {
  return `${publicSite}/c/${token}`
}

export function appCheckinUrl(token: string): string {
  return `hrsystem://c/${token}`
}

export function nfcCheckinUrl(token: string): string {
  const web = encodeURIComponent(webCheckinUrl(token))
  return `intent://c/${token}#Intent;scheme=hrsystem;package=com.hrsystem.app;S.browser_fallback_url=${web};end`
}

export function checkinPathFromUrl(url: string | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    const path = parsed.protocol === "hrsystem:" || parsed.protocol === "intent:"
      ? `/${parsed.hostname}${parsed.pathname}`.replace(/\/{2,}/g, "/")
      : parsed.pathname
    const match = path.match(/\/c\/([0-9a-fA-F]+)\/?$/)
    if (!match) return null
    return `/c/${match[1]}`
  } catch {
    return null
  }
}
