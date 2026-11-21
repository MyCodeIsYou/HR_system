import { createClient } from "npm:@supabase/supabase-js@2"

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
  leave_digest_emails: string[] | null
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

function dayAmount(minutes: number): string {
  const days = Math.round((minutes / 480) * 100) / 100
  const text = Math.abs(days).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")
  return `${text}일`
}

function digestText(orgName: string, start: string, end: string, rows: LeaveRow[]): string {
  const lines = [
    `${orgName} 이번 주 휴가 일정입니다.`,
    `${dayText(start)} – ${dayText(end)}`,
    "",
  ]
  for (let offset = 0; offset < 7; offset += 1) {
    const date = addDays(start, offset)
    const items = rows
      .filter((row) => row.work_date === date)
      .sort((left, right) => personName(left.profile).localeCompare(personName(right.profile), "ko"))
    lines.push(dayText(date))
    if (items.length === 0) {
      lines.push("- 없음")
    } else {
      for (const row of items) {
        const waiting = row.status === "pending" ? " (대기)" : ""
        lines.push(`- ${personName(row.profile)} · ${kindLabel(row)} ${dayAmount(row.minutes)}${waiting}`)
      }
    }
    lines.push("")
  }
  lines.push("대기 중인 신청은 아직 승인 전입니다.")
  return lines.join("\n")
}

async function sendMail(from: string, apiKey: string, recipients: string[], subject: string, text: string) {
  const payload: Record<string, unknown> = {
    from,
    to: [recipients[0]],
    subject,
    text,
  }
  if (recipients.length > 1) payload.bcc = recipients.slice(1)
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(detail.slice(0, 300) || "메일을 보내지 못했습니다.")
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceKey) return json({ error: "서버 설정이 없습니다." }, 500)
  const admin = createClient(supabaseUrl, serviceKey)

  const expected = Deno.env.get("WEEKLY_LEAVE_SECRET") ?? ""
  const provided = req.headers.get("x-cron-secret") ?? ""
  const cron = Boolean(expected) && provided === expected
  let testOrgId: string | null = null
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
    if (profile?.role !== "admin" || !profile.organization_id) return json({ error: "관리자만 테스트 메일을 보낼 수 있습니다." }, 403)
    testOrgId = profile.organization_id
  }

  const apiKey = Deno.env.get("RESEND_API_KEY") ?? ""
  const from = Deno.env.get("LEAVE_DIGEST_FROM") ?? ""
  if (!apiKey || !from) {
    return json({ error: "메일 발신 설정(RESEND_API_KEY, LEAVE_DIGEST_FROM)이 없습니다." }, 500)
  }

  const { start, end } = thisWeek()
  const [orgResult, leaveResult, sentResult] = await Promise.all([
    admin.from("organizations").select("id, name, leave_digest_emails, leave_digest_weekday, leave_digest_time"),
    admin
      .from("leave_requests")
      .select("organization_id, work_date, minutes, status, kind_name, leave_type, profile:profiles!leave_requests_user_id_fkey(name)")
      .gte("work_date", start)
      .lte("work_date", end)
      .in("status", ["approved", "pending"]),
    admin.from("leave_digest_sends").select("organization_id").eq("week_start", start),
  ])
  if (orgResult.error) return json({ error: orgResult.error.message }, 500)
  if (leaveResult.error) return json({ error: leaveResult.error.message }, 500)
  if (sentResult.error) return json({ error: sentResult.error.message }, 500)

  const sentIds = new Set((sentResult.data ?? []).map((row) => row.organization_id as string))
  const results: { organization: string; recipients: number; status: string }[] = []

  for (const org of (orgResult.data ?? []) as OrgRow[]) {
    if (testOrgId && org.id !== testOrgId) continue
    const testing = testOrgId === org.id
    if (!testing && sentIds.has(org.id)) {
      results.push({ organization: org.name, recipients: 0, status: "이미 발송" })
      continue
    }
    if (!testing && !isDue(org.leave_digest_weekday ?? 1, org.leave_digest_time ?? "09:00")) {
      results.push({ organization: org.name, recipients: 0, status: "시각 전" })
      continue
    }
    const recipients = [
      ...new Set(
        (org.leave_digest_emails ?? [])
          .map((email) => email.trim().toLowerCase())
          .filter((email) => email.includes("@")),
      ),
    ]
    if (recipients.length === 0) {
      results.push({ organization: org.name, recipients: 0, status: "받을 주소 없음" })
      continue
    }
    const rows = ((leaveResult.data ?? []) as LeaveRow[]).filter((row) => row.organization_id === org.id)
    const subject = `${testing ? "[테스트] " : ""}[근태] ${dayText(start)}–${dayText(end)} 휴가 일정`
    const text = `${testing ? "테스트 발송입니다.\n\n" : ""}${digestText(org.name, start, end, rows)}`
    try {
      await sendMail(from, apiKey, recipients, subject, text)
      if (!testing) {
        const { error: saveError } = await admin.from("leave_digest_sends").upsert({
          organization_id: org.id,
          week_start: start,
          sent_at: new Date().toISOString(),
          recipient_count: recipients.length,
        })
        if (saveError) throw new Error(saveError.message)
      }
      results.push({ organization: org.name, recipients: recipients.length, status: "발송" })
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "메일을 보내지 못했습니다."
      results.push({ organization: org.name, recipients: recipients.length, status: message })
    }
  }

  const failed = results.some((row) => !["발송", "이미 발송", "받을 주소 없음", "시각 전"].includes(row.status))
  return json({ week_start: start, week_end: end, results }, failed ? 500 : 200)
})
