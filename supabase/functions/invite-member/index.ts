import { createClient } from "npm:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

type InviteBody = {
  email?: string
  name?: string
  role?: string
  workplace_id?: string | null
  employee_number?: string | null
  hired_at?: string | null
  initial_annual_days?: number
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json({ error: "서버 설정이 없습니다." }, 500)
  }

  const authorization = req.headers.get("Authorization")
  if (!authorization) return json({ error: "로그인이 필요합니다." }, 401)

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) return json({ error: "로그인이 필요합니다." }, 401)

  const admin = createClient(supabaseUrl, serviceKey)
  const { data: caller, error: callerError } = await admin
    .from("profiles")
    .select("role, organization_id")
    .eq("id", userData.user.id)
    .maybeSingle()

  if (callerError) return json({ error: callerError.message }, 500)
  if (!caller || caller.role !== "admin" || !caller.organization_id) {
    return json({ error: "관리자만 구성원을 초대할 수 있습니다." }, 403)
  }

  const body = (await req.json()) as InviteBody
  const email = body.email?.trim().toLowerCase() ?? ""
  const name = body.name?.trim() ?? ""
  const role = body.role === "admin" ? "admin" : "employee"
  const workplaceId = body.workplace_id || null
  const employeeNumber = body.employee_number?.trim() || null
  const hiredAt = body.hired_at || null
  const annualDays = Number(body.initial_annual_days ?? 0)

  if (!email.includes("@") || !name) {
    return json({ error: "이메일과 이름을 입력하세요." }, 400)
  }
  if (!Number.isFinite(annualDays) || annualDays < 0 || annualDays > 100) {
    return json({ error: "초기 연차는 0일에서 100일 사이로 입력하세요." }, 400)
  }
  if (workplaceId) {
    const { data: workplace, error: workplaceError } = await admin
      .from("workplaces")
      .select("id")
      .eq("id", workplaceId)
      .eq("organization_id", caller.organization_id)
      .maybeSingle()
    if (workplaceError) return json({ error: workplaceError.message }, 500)
    if (!workplace) return json({ error: "소속 사업장을 찾을 수 없습니다." }, 400)
  }

  const { data: existing } = await admin
    .from("profiles")
    .select("id, organization_id")
    .ilike("email", email)
    .maybeSingle()
  if (existing?.organization_id) {
    return json({ error: "이미 등록된 이메일입니다." }, 409)
  }

  let userId = existing?.id
  if (!userId) {
    const origin = req.headers.get("origin")
    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { name },
      redirectTo: origin ? `${origin}/login` : undefined,
    })
    userId = invited.user?.id
    if (inviteError || !userId) {
      const message = inviteError?.message ?? "초대 메일을 보내지 못했습니다."
      if (message.toLowerCase().includes("already")) {
        return json({ error: "이미 가입된 이메일입니다. 그 계정으로 로그인한 뒤 관리자에게 다시 요청하세요." }, 409)
      }
      return json({ error: message }, 400)
    }
  }

  const profile = {
    organization_id: caller.organization_id,
    workplace_id: workplaceId,
    name,
    email,
    role,
    employee_number: employeeNumber,
    hired_at: hiredAt,
  }

  const { data: updated, error: updateError } = await admin
    .from("profiles")
    .update(profile)
    .eq("id", userId)
    .select("id")
    .maybeSingle()
  if (updateError) return json({ error: updateError.message }, 500)

  if (!updated) {
    const { error: insertError } = await admin.from("profiles").insert({ id: userId, ...profile })
    if (insertError) return json({ error: insertError.message }, 500)
  }

  const minutes = Math.round(annualDays * 480)
  if (minutes > 0) {
    const { data: alreadyGranted } = await admin
      .from("leave_ledger")
      .select("id")
      .eq("user_id", userId)
      .eq("reason", "초기 연차 지급")
      .limit(1)
      .maybeSingle()
    if (!alreadyGranted) {
      const { error: leaveError } = await admin.from("leave_ledger").insert({
        organization_id: caller.organization_id,
        user_id: userId,
        leave_type: "annual",
        delta_minutes: minutes,
        reason: "초기 연차 지급",
        created_by: userData.user.id,
      })
      if (leaveError) return json({ error: leaveError.message }, 500)
    }
  }

  return json({ ok: true })
})
