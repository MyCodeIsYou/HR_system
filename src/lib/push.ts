import { supabase } from "./supabase.ts"

export const vapidPublicKey = "BOwStzHgz9xxIg7NlWBSm_7wwMh2lKIajiIa30VASEF6eRJIgO6oxUfWJaWsOK1ZlNAMV225QdWu97ClaFjNXGw"

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index)
  return output
}

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration) return null
  return registration.pushManager.getSubscription()
}

export async function enablePush(userId: string, organizationId: string): Promise<void> {
  if (!pushSupported()) throw new Error("이 브라우저는 알림을 지원하지 않습니다.")
  const registration = await navigator.serviceWorker.getRegistration()
  if (!registration) throw new Error("알림은 설치한 앱이나 배포된 사이트에서 켤 수 있습니다. 아이폰은 홈 화면에 추가한 앱에서 켜 주세요.")
  const permission = await Notification.requestPermission()
  if (permission !== "granted") throw new Error("알림 권한을 허용해 주세요.")
  const existing = await registration.pushManager.getSubscription()
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    }))
  const json = subscription.toJSON()
  const endpoint = json.endpoint
  const p256dh = json.keys?.p256dh
  const auth = json.keys?.auth
  if (!endpoint || !p256dh || !auth) throw new Error("알림 구독을 만들지 못했습니다.")
  const { error } = await supabase.from("push_subscriptions").upsert(
    { user_id: userId, organization_id: organizationId, endpoint, p256dh, auth },
    { onConflict: "user_id,endpoint" },
  )
  if (error) throw new Error(error.message)
}

export async function disablePush(userId: string): Promise<void> {
  const subscription = await currentPushSubscription()
  const endpoint = subscription?.endpoint
  if (subscription) await subscription.unsubscribe()
  if (!endpoint) return
  const { error } = await supabase.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", endpoint)
  if (error) throw new Error(error.message)
}
