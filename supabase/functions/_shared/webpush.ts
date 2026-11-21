import webpush from "npm:web-push@3.6.7"

export type PushTarget = {
  endpoint: string
  p256dh: string
  auth: string
}

export type PushNote = {
  title: string
  body: string
  url: string
}

export function pushReady(): boolean {
  return Boolean(Deno.env.get("VAPID_PUBLIC_KEY") && Deno.env.get("VAPID_PRIVATE_KEY"))
}

export async function sendPush(targets: PushTarget[], note: PushNote) {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY") ?? ""
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY") ?? ""
  if (!publicKey || !privateKey) throw new Error("웹 푸시 키가 없습니다.")
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT") ?? "https://mycodeisyou.github.io/HR_system", publicKey, privateKey)
  const body = JSON.stringify(note)
  const gone: string[] = []
  const errors: string[] = []
  let sent = 0
  for (const target of targets) {
    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        body,
      )
      sent += 1
    } catch (caught) {
      const status = typeof caught === "object" && caught && "statusCode" in caught ? Number(caught.statusCode) : 0
      if (status === 404 || status === 410) gone.push(target.endpoint)
      else errors.push(caught instanceof Error ? caught.message.slice(0, 180) : "푸시를 보내지 못했습니다.")
    }
  }
  return { sent, gone, errors }
}
