import { createClient } from "npm:@supabase/supabase-js@2"
import { sendPush, type PushTarget } from "../_shared/webpush.ts"

const SEND_MINUTES = 17 * 60

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
}

type LeaveRow = {
  user_id: string
  work_date: string
  kind_name: string | null
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function seoulDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + days))
  const nextMonth = String(next.getUTCMonth() + 1).padStart(2, "0")
  const nextDay = String(next.getUTCDate()).padStart(2, "0")
  return `${next.getUTCFullYear()}-${nextMonth}-${nextDay}`
}

function seoulMinutes(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return Number(value.hour) * 60 + Number(value.minute)
}

function kindLabel(name: string | null): string {
  const trimmed = name?.trim()
  return trimmed || "휴가"
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceKey) return json({ error: "서버 설정이 없습니다." }, 500)
  const admin = createClient(supabaseUrl, serviceKey)

  const expected = Deno.env.get("WEEKLY_LEAVE_SECRET") ?? ""
  const provided = req.headers.get("x-cron-secret") ?? ""
  if (!expected || provided !== expected) return json({ error: "배치 인증에 실패했습니다." }, 401)

  const tomorrow = addDays(seoulDate(new Date()), 1)
  if (seoulMinutes() < SEND_MINUTES) return json({ date: tomorrow, status: "시각 전" })

  const leaveResult = await admin
    .from("leave_requests")
    .select("user_id, work_date, kind_name")
    .eq("work_date", tomorrow)
    .eq("status", "approved")
  if (leaveResult.error) return json({ error: leaveResult.error.message }, 500)

  const leaves = (leaveResult.data ?? []) as LeaveRow[]
  if (leaves.length === 0) return json({ date: tomorrow, status: "대상 없음", sent: 0 })

  const userIds = [...new Set(leaves.map((row) => row.user_id))]
  const [sentResult, subscriptionResult] = await Promise.all([
    admin.from("leave_eve_sends").select("user_id").eq("work_date", tomorrow).in("user_id", userIds),
    admin.from("push_subscriptions").select("user_id, endpoint, p256dh, auth").in("user_id", userIds),
  ])
  if (sentResult.error) return json({ error: sentResult.error.message }, 500)
  if (subscriptionResult.error) return json({ error: subscriptionResult.error.message }, 500)

  const sentIds = new Set((sentResult.data ?? []).map((row) => row.user_id as string))
  const subscriptions = (subscriptionResult.data ?? []) as Array<PushTarget & { user_id: string }>
  const results: { user_id: string; status: string }[] = []
  const gone: string[] = []

  for (const leave of leaves) {
    if (sentIds.has(leave.user_id)) {
      results.push({ user_id: leave.user_id, status: "이미 발송" })
      continue
    }
    const targets = subscriptions.filter((row) => row.user_id === leave.user_id)
    if (targets.length === 0) {
      results.push({ user_id: leave.user_id, status: "알림을 켠 기기가 없습니다." })
      continue
    }
    const kind = kindLabel(leave.kind_name)
    try {
      const delivered = await sendPush(targets, {
        title: `내일은 ${kind}입니다`,
        body: "즐거운 휴가 되세요.",
        url: "leave",
      })
      gone.push(...delivered.gone)
      if (delivered.sent === 0) throw new Error(delivered.errors[0] ?? "푸시를 보내지 못했습니다.")
      const { error: saveError } = await admin.from("leave_eve_sends").upsert({
        user_id: leave.user_id,
        work_date: tomorrow,
        sent_at: new Date().toISOString(),
      })
      if (saveError) throw new Error(saveError.message)
      sentIds.add(leave.user_id)
      results.push({ user_id: leave.user_id, status: "발송" })
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "푸시를 보내지 못했습니다."
      results.push({ user_id: leave.user_id, status: message })
    }
  }

  if (gone.length > 0) {
    await admin.from("push_subscriptions").delete().in("endpoint", [...new Set(gone)])
  }

  const failed = results.some((row) => !["발송", "이미 발송", "알림을 켠 기기가 없습니다."].includes(row.status))
  return json({ date: tomorrow, results }, failed ? 500 : 200)
})
