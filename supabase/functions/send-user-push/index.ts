import { createClient } from "npm:@supabase/supabase-js@2"
import { sendPush, type PushTarget } from "../_shared/webpush.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceKey) return json({ error: "서버 설정이 없습니다." }, 500)
  const admin = createClient(supabaseUrl, serviceKey)

  const payload = (await req.json().catch(() => ({}))) as { user_ids?: unknown; title?: unknown; body?: unknown }
  const title = typeof payload.title === "string" ? payload.title.trim() : ""
  const body = typeof payload.body === "string" ? payload.body.trim() : ""
  const userIds = Array.isArray(payload.user_ids)
    ? [...new Set(payload.user_ids.filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)))]
    : []
  if (!title || title.length > 40) return json({ error: "제목은 40자 안으로 입력해 주세요." }, 400)
  if (!body || body.length > 180) return json({ error: "내용은 180자 안으로 입력해 주세요." }, 400)
  if (userIds.length === 0 || userIds.length > 50) return json({ error: "받을 사람을 선택해 주세요." }, 400)

  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "")
  if (!jwt) return json({ error: "로그인이 필요합니다." }, 401)
  const { data: userData, error: userError } = await admin.auth.getUser(jwt)
  if (userError || !userData.user) return json({ error: "로그인이 필요합니다." }, 401)
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role, organization_id")
    .eq("id", userData.user.id)
    .maybeSingle()
  if (profileError) return json({ error: profileError.message }, 500)
  if (profile?.role !== "admin" || !profile.organization_id) return json({ error: "관리자만 알림을 보낼 수 있습니다." }, 403)

  const [peopleResult, subscriptionResult] = await Promise.all([
    admin.from("profiles").select("id, name").eq("organization_id", profile.organization_id).in("id", userIds),
    admin
      .from("push_subscriptions")
      .select("user_id, endpoint, p256dh, auth")
      .eq("organization_id", profile.organization_id)
      .in("user_id", userIds),
  ])
  if (peopleResult.error) return json({ error: peopleResult.error.message }, 500)
  if (subscriptionResult.error) return json({ error: subscriptionResult.error.message }, 500)
  const people = (peopleResult.data ?? []) as { id: string; name: string }[]
  if (people.length !== userIds.length) return json({ error: "구성원을 확인해 주세요." }, 400)

  const subscriptions = (subscriptionResult.data ?? []) as Array<PushTarget & { user_id: string }>
  const note = { title, body, url: "./" }
  const skipped: string[] = []
  const gone: string[] = []
  let sent = 0
  let pushError = ""
  for (const person of people) {
    const targets = subscriptions.filter((row) => row.user_id === person.id)
    if (targets.length === 0) {
      skipped.push(person.name)
      continue
    }
    try {
      const delivered = await sendPush(targets, note)
      gone.push(...delivered.gone)
      if (delivered.sent > 0) sent += 1
      else {
        skipped.push(person.name)
        pushError = delivered.errors[0] ?? "알림을 보내지 못했습니다."
      }
    } catch (caught) {
      skipped.push(person.name)
      pushError = caught instanceof Error ? caught.message : "알림을 보내지 못했습니다."
    }
  }
  if (gone.length > 0) {
    await admin.from("push_subscriptions").delete().in("endpoint", [...new Set(gone)])
  }
  if (sent === 0) {
    return json({ error: pushError || "선택한 사람은 알림이 꺼져 있습니다.", skipped }, 400)
  }
  return json({ sent, skipped })
})
