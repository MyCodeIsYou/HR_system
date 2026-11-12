const publicSite = "https://mycodeisyou.github.io/HR_system"

export function webCheckinUrl(token: string): string {
  return `${publicSite}/c/${token}`
}

export function appCheckinUrl(token: string): string {
  return `hrsystem://c/${token}`
}

export function nfcCheckinUrl(token: string): string {
  return webCheckinUrl(token)
}

export function appLaunchUrl(token: string, fallback: string): string {
  return `intent://c/${token}#Intent;scheme=hrsystem;package=com.hrsystem.app;S.browser_fallback_url=${encodeURIComponent(fallback)};end`
}

export function shouldOfferApp(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false
  const host = window as Window & { ReactNativeWebView?: unknown; $$EXPO_DOM_HOST_OS?: string }
  if (host.ReactNativeWebView || host.$$EXPO_DOM_HOST_OS) return false
  if (window.location.hostname !== "mycodeisyou.github.io") return false
  if (!/Android/i.test(navigator.userAgent)) return false
  return new URLSearchParams(window.location.search).get("web") !== "1"
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
