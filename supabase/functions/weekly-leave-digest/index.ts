import { createClient } from "npm:@supabase/supabase-js@2"
import { sendPush, type PushTarget } from "../_shared/webpush.ts"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
}

type LeaveRow = {
  organization_id: string
  work_date: string
  minutes: number
  status: string
  kind_name: string | null
  leave_type: string | null
  profile: { name: string } | { name: string }[] | null
}

type OrgRow = {
  id: string
  name: string
  leave_digest_weekday: number | null
  leave_digest_time: string | null
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

function weekdayIndex(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + days))
  const nextMonth = String(next.getUTCMonth() + 1).padStart(2, "0")
  const nextDay = String(next.getUTCDate()).padStart(2, "0")
  return `${next.getUTCFullYear()}-${nextMonth}-${nextDay}`
}

const seoulWeekday: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

function seoulClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const hour = Number(value.hour)
  const minute = Number(value.minute)
  return {
    weekday: seoulWeekday[value.weekday] ?? -1,
    minutes: hour * 60 + minute,
  }
}

function isDue(weekday: number, time: string, now = new Date()): boolean {
  const clock = seoulClock(now)
  if (clock.weekday !== weekday) return false
  const [hour, minute] = time.slice(0, 5).split(":").map(Number)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false
  return clock.minutes >= hour * 60 + minute
}

function thisWeek(now = new Date()) {
  const today = seoulDate(now)
  const weekday = weekdayIndex(today)
  const start = addDays(today, weekday === 0 ? -6 : 1 - weekday)
  return { start, end: addDays(start, 6) }
}

function dayText(iso: string): string {
  const [, month, day] = iso.split("-")
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][weekdayIndex(iso)]
  return `${Number(month)}월 ${Number(day)}일 (${weekday})`
}

function personName(value: LeaveRow["profile"]): string {
  if (!value) return "이름 없음"
  return Array.isArray(value) ? value[0]?.name ?? "이름 없음" : value.name
}

function kindLabel(row: LeaveRow): string {
  const name = row.kind_name?.trim()
  if (name) return name
  if (row.leave_type === "annual") return "연차"
  if (row.leave_type === "comp") return "보상휴가"
  if (row.leave_type === "summer") return "여름휴가"
  return "휴가"
}

function pushBody(rows: LeaveRow[]): string {
  if (rows.length === 0) return "이번 주 휴가 일정이 없습니다."
  const lines = rows.slice(0, 6).map((row) => `${dayText(row.work_date)} ${personName(row.profile)} · ${kindLabel(row)}`)
  if (rows.length > 6) lines.push(`외 ${rows.length - 6}건`)
  return lines.join("\n")
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceKey) return json({ error: "서버 설정이 없습니다." }, 500)
  const admin = createClient(supabaseUrl, serviceKey)

  await req.json().catch(() => ({}))
  const expected = Deno.env.get("WEEKLY_LEAVE_SECRET") ?? ""
  const provided = req.headers.get("x-cron-secret") ?? ""
  const cron = Boolean(expected) && provided === expected
  let testOrgId: string | null = null
  let testUserId: string | null = null
  if (!cron) {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "")
    if (!jwt) return json({ error: "배치 인증에 실패했습니다." }, 401)
    const { data: userData, error: userError } = await admin.auth.getUser(jwt)
    if (userError || !userData.user) return json({ error: "로그인이 필요합니다." }, 401)
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("role, organization_id")
      .eq("id", userData.user.id)
      .maybeSingle()
    if (profileError) return json({ error: profileError.message }, 500)
    if (profile?.role !== "admin" || !profile.organization_id) {
      return json({ error: "관리자만 테스트 알림을 보낼 수 있습니다." }, 403)
    }
    testOrgId = profile.organization_id
    testUserId = userData.user.id
  }

  const { start, end } = thisWeek()
  const [orgResult, leaveResult, sentResult, subscriptionResult] = await Promise.all([
    admin.from("organizations").select("id, name, leave_digest_weekday, leave_digest_time"),
    admin
      .from("leave_requests")
      .select("organization_id, work_date, minutes, status, kind_name, leave_type, profile:profiles!leave_requests_user_id_fkey(name)")
      .gte("work_date", start)
      .lte("work_date", end)
      .in("status", ["approved", "pending"]),
    admin.from("leave_digest_sends").select("organization_id").eq("week_start", start),
    admin.from("push_subscriptions").select("organization_id, user_id, endpoint, p256dh, auth"),
  ])
  if (orgResult.error) return json({ error: orgResult.error.message }, 500)
  if (leaveResult.error) return json({ error: leaveResult.error.message }, 500)
  if (sentResult.error) return json({ error: sentResult.error.message }, 500)
  if (subscriptionResult.error) return json({ error: subscriptionResult.error.message }, 500)

  const sentIds = new Set((sentResult.data ?? []).map((row) => row.organization_id as string))
  const subscriptions = (subscriptionResult.data ?? []) as Array<PushTarget & { organization_id: string; user_id: string }>
  const results: { organization: string; recipients: number; status: string }[] = []

  for (const org of (orgResult.data ?? []) as OrgRow[]) {
    if (testOrgId && org.id !== testOrgId) continue
    const testing = Boolean(testOrgId)
    if (!testing && sentIds.has(org.id)) {
      results.push({ organization: org.name, recipients: 0, status: "이미 발송" })
      continue
    }
    if (!testing && !isDue(org.leave_digest_weekday ?? 1, org.leave_digest_time ?? "09:00")) {
      results.push({ organization: org.name, recipients: 0, status: "시각 전" })
      continue
    }
    const targets = subscriptions.filter((row) => row.organization_id === org.id && (!testing || row.user_id === testUserId))
    if (!testing && targets.length === 0) {
      results.push({ organization: org.name, recipients: 0, status: "받을 곳이 없습니다." })
      continue
    }
    const rows = ((leaveResult.data ?? []) as LeaveRow[]).filter((row) => row.organization_id === org.id)
    let pushSent = 0
    let pushError = ""
    if (targets.length > 0) {
      try {
        const delivered = await sendPush(targets, {
          title: testing ? "휴가 알림 테스트" : `${dayText(start)} 휴가`,
          body: testing ? "알림이 이 기기로 도착했습니다." : pushBody(rows),
          url: "admin/leaves",
        })
        if (delivered.gone.length > 0) {
          await admin.from("push_subscriptions").delete().in("endpoint", delivered.gone)
        }
        if (delivered.sent === 0) throw new Error(delivered.errors[0] ?? "푸시를 보내지 못했습니다.")
        pushSent = delivered.sent
      } catch (caught) {
        pushError = caught instanceof Error ? caught.message : "푸시를 보내지 못했습니다."
      }
    }
    if (!testing && pushSent > 0) {
      const { error: saveError } = await admin.from("leave_digest_sends").upsert({
        organization_id: org.id,
        week_start: start,
        sent_at: new Date().toISOString(),
        recipient_count: pushSent,
      })
      if (saveError) {
        results.push({ organization: org.name, recipients: pushSent, status: saveError.message })
        continue
      }
    }
    let status = "발송"
    if (pushSent === 0) {
      status = targets.length === 0 ? (testing ? "알림을 켠 기기가 없습니다." : "받을 곳이 없습니다.") : pushError || "푸시를 보내지 못했습니다."
    }
    results.push({ organization: org.name, recipients: pushSent, status })
  }

  const quiet = ["발송", "이미 발송", "시각 전", "받을 곳이 없습니다."]
  const failed = results.some((row) => !quiet.includes(row.status))
  return json({ week_start: start, week_end: end, results }, failed ? 500 : 200)
})
