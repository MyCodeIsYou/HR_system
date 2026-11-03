-- NFC 출퇴근, 지각 제재, 야근 보상휴가.
-- Supabase SQL 편집기에서 실행하거나 `supabase db push`로 적용합니다.
-- 최초 사용자는 앱에서 가입한 뒤 조직을 만듭니다. 이후 구성원은 관리자 초대로 들어옵니다.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function public.random_token()
returns text
language sql
volatile
set search_path = public, extensions
as $$
  select encode(gen_random_bytes(16), 'hex');
$$;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

create table public.workplaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  address text,
  nfc_token text not null unique default '',
  timezone text not null default 'Asia/Seoul',
  work_start time not null default '09:00',
  work_end time not null default '18:00',
  late_grace_minutes integer not null default 0 check (late_grace_minutes >= 0),
  late_policy text not null default 'none' check (late_policy in ('fine', 'annual_leave', 'none')),
  fine_mode text not null default 'flat' check (fine_mode in ('flat', 'per_minute')),
  fine_amount integer not null default 0 check (fine_amount >= 0),
  leave_deduction_mode text not null default 'exact_minutes' check (leave_deduction_mode in ('exact_minutes', 'per_occurrence')),
  leave_deduction_minutes integer not null default 60 check (leave_deduction_minutes >= 0),
  overtime_start time not null default '18:00',
  comp_leave_ratio_overtime_minutes integer not null default 1 check (comp_leave_ratio_overtime_minutes >= 1),
  comp_leave_ratio_leave_minutes integer not null default 1 check (comp_leave_ratio_leave_minutes >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete set null,
  workplace_id uuid references public.workplaces (id) on delete set null,
  name text not null,
  email text,
  role text not null default 'employee' check (role in ('admin', 'employee')),
  job_title text,
  employee_number text,
  hired_at date,
  created_at timestamptz not null default now()
);

create unique index profiles_employee_number_uidx
  on public.profiles (organization_id, employee_number)
  where employee_number is not null and organization_id is not null;

create table public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workplace_id uuid not null references public.workplaces (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete cascade,
  event_type text not null check (event_type in ('in', 'out')),
  occurred_at timestamptz not null,
  work_date date not null,
  source text not null check (source in ('nfc', 'manual')),
  pair_event_id uuid references public.attendance_events (id) on delete set null,
  summary jsonb not null default '{}'::jsonb,
  voided_at timestamptz,
  created_at timestamptz not null default now()
);

create index attendance_events_user_time_idx
  on public.attendance_events (user_id, occurred_at desc);

create index attendance_events_org_date_idx
  on public.attendance_events (organization_id, work_date desc);

create table public.attendance_adjustments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_id uuid,
  user_id uuid not null,
  workplace_id uuid references public.workplaces (id) on delete set null,
  action text not null check (action in ('add_event', 'void_event')),
  event_id uuid references public.attendance_events (id) on delete set null,
  note text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint attendance_adjustments_actor_id_fkey
    foreign key (actor_id) references public.profiles (id) on delete set null,
  constraint attendance_adjustments_user_id_fkey
    foreign key (user_id) references public.profiles (id) on delete cascade
);

create table public.leave_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null,
  leave_type text not null check (leave_type in ('annual', 'comp', 'summer')),
  delta_minutes integer not null,
  reason text not null,
  ref_table text,
  ref_id uuid,
  work_date date,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint leave_ledger_user_id_fkey
    foreign key (user_id) references public.profiles (id) on delete cascade,
  constraint leave_ledger_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null
);

create index leave_ledger_user_type_idx
  on public.leave_ledger (user_id, leave_type);

create table public.late_penalties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  workplace_id uuid not null references public.workplaces (id) on delete restrict,
  attendance_event_id uuid not null references public.attendance_events (id) on delete cascade,
  work_date date not null,
  late_minutes integer not null check (late_minutes >= 0),
  penalty_type text not null check (penalty_type in ('fine', 'annual_leave', 'none')),
  fine_amount integer not null default 0 check (fine_amount >= 0),
  leave_minutes_deducted integer not null default 0 check (leave_minutes_deducted >= 0),
  voided_at timestamptz,
  created_at timestamptz not null default now()
);

create index late_penalties_user_date_idx
  on public.late_penalties (user_id, work_date desc);

create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger workplaces_set_updated_at
  before update on public.workplaces
  for each row execute function public.set_updated_at();

create or replace function public.workplaces_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform now() at time zone new.timezone;
  exception when others then
    raise exception '시간대를 확인할 수 없습니다';
  end;

  if tg_op = 'INSERT' or new.nfc_token is null then
    new.nfc_token := public.random_token();
  elsif tg_op = 'UPDATE' and new.nfc_token is distinct from old.nfc_token then
    if current_setting('app.allow_token_rotate', true) is distinct from 'on' then
      new.nfc_token := old.nfc_token;
    end if;
  end if;

  return new;
end;
$$;

create trigger workplaces_guard
  before insert or update on public.workplaces
  for each row execute function public.workplaces_guard();

create or replace function public.profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.name := trim(new.name);
  if char_length(new.name) = 0 then
    raise exception '이름을 입력하세요';
  end if;

  if new.employee_number is not null then
    new.employee_number := nullif(trim(new.employee_number), '');
  end if;
  if new.job_title is not null then
    new.job_title := nullif(trim(new.job_title), '');
  end if;

  if new.role not in ('admin', 'employee') then
    raise exception '역할이 올바르지 않습니다';
  end if;

  if new.workplace_id is not null and (
    new.organization_id is null
    or not exists (
      select 1 from public.workplaces w
      where w.id = new.workplace_id and w.organization_id = new.organization_id
    )
  ) then
    raise exception '소속 사업장이 조직과 맞지 않습니다';
  end if;

  if tg_op = 'INSERT' then
    return new;
  end if;

  if current_setting('app.bypass_profile_guard', true) = 'on' or auth.uid() is null then
    return new;
  end if;

  if public.is_admin() and old.organization_id is not distinct from public.current_org_id() then
    if new.organization_id is distinct from old.organization_id then
      raise exception '조직은 변경할 수 없습니다';
    end if;
    return new;
  end if;

  if auth.uid() = old.id then
    new.role := old.role;
    new.organization_id := old.organization_id;
    new.workplace_id := old.workplace_id;
    new.employee_number := old.employee_number;
    new.job_title := old.job_title;
    new.hired_at := old.hired_at;
    new.email := old.email;
    return new;
  end if;

  raise exception '권한이 없습니다';
end;
$$;

create trigger profiles_guard
  before insert or update on public.profiles
  for each row execute function public.profiles_guard();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)),
    new.email,
    'employee'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.apply_clock_in(
  p_user_id uuid,
  p_workplace public.workplaces,
  p_occurred_at timestamptz,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_local timestamp;
  v_work_date date;
  v_start timestamptz;
  v_deadline timestamptz;
  v_late_minutes integer := 0;
  v_fine integer := 0;
  v_deduct integer := 0;
  v_event_id uuid;
  v_summary jsonb;
  v_already boolean;
  v_overtime_at timestamptz;
  v_overtime_started boolean := false;
begin
  v_local := p_occurred_at at time zone p_workplace.timezone;
  v_work_date := v_local::date;
  v_start := (v_work_date + p_workplace.work_start) at time zone p_workplace.timezone;
  v_deadline := v_start + make_interval(mins => p_workplace.late_grace_minutes);
  v_overtime_at := (v_work_date + p_workplace.overtime_start) at time zone p_workplace.timezone;

  select exists (
    select 1
    from public.attendance_events
    where user_id = p_user_id
      and voided_at is null
      and event_type = 'in'
      and work_date = v_work_date
  ) into v_already;

  if p_occurred_at >= v_overtime_at then
    v_overtime_started := true;
  elsif not v_already and p_occurred_at > v_deadline then
    v_late_minutes := ceil(extract(epoch from (p_occurred_at - v_start)) / 60.0)::integer;
  end if;

  if v_late_minutes > 0 and p_workplace.late_policy = 'fine' then
    v_fine := case
      when p_workplace.fine_mode = 'per_minute' then v_late_minutes * p_workplace.fine_amount
      else p_workplace.fine_amount
    end;
  elsif v_late_minutes > 0 and p_workplace.late_policy = 'annual_leave' then
    v_deduct := case
      when p_workplace.leave_deduction_mode = 'per_occurrence' then p_workplace.leave_deduction_minutes
      else v_late_minutes
    end;
  end if;

  insert into public.attendance_events (
    organization_id, workplace_id, user_id, event_type, occurred_at, work_date, source, summary
  ) values (
    p_workplace.organization_id, p_workplace.id, p_user_id, 'in', p_occurred_at, v_work_date, p_source, '{}'::jsonb
  )
  returning id into v_event_id;

  if v_late_minutes > 0 then
    insert into public.late_penalties (
      organization_id, user_id, workplace_id, attendance_event_id, work_date,
      late_minutes, penalty_type, fine_amount, leave_minutes_deducted
    ) values (
      p_workplace.organization_id, p_user_id, p_workplace.id, v_event_id, v_work_date,
      v_late_minutes, p_workplace.late_policy, v_fine, v_deduct
    );

    if v_deduct > 0 then
      insert into public.leave_ledger (
        organization_id, user_id, leave_type, delta_minutes, reason, ref_table, ref_id, work_date
      ) values (
        p_workplace.organization_id, p_user_id, 'annual', -v_deduct, '지각 연차 차감',
        'attendance_events', v_event_id, v_work_date
      );
    end if;
  end if;

  v_summary := jsonb_build_object(
    'status', 'recorded',
    'action', 'in',
    'occurred_at', p_occurred_at,
    'work_date', v_work_date,
    'workplace_id', p_workplace.id,
    'workplace_name', p_workplace.name,
    'late_minutes', v_late_minutes,
    'penalty_type', case when v_late_minutes > 0 then p_workplace.late_policy else null end,
    'fine_amount', v_fine,
    'leave_minutes_deducted', v_deduct,
    'overtime_minutes', 0,
    'comp_leave_minutes_granted', 0,
    'overtime_started', v_overtime_started,
    'event_id', v_event_id,
    'notice', null
  );

  update public.attendance_events set summary = v_summary where id = v_event_id;
  return v_summary;
end;
$$;

create or replace function public.apply_clock_out(
  p_user_id uuid,
  p_workplace public.workplaces,
  p_occurred_at timestamptz,
  p_source text,
  p_pair_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_in public.attendance_events;
  v_work_date date;
  v_threshold timestamptz;
  v_ot_from timestamptz;
  v_overtime_minutes integer := 0;
  v_granted integer := 0;
  v_event_id uuid;
  v_summary jsonb;
begin
  if p_pair_id is not null then
    select * into v_in from public.attendance_events where id = p_pair_id;
    if not found then
      raise exception '연결된 출근 기록을 찾을 수 없습니다';
    end if;
    v_work_date := v_in.work_date;
    v_threshold := (v_in.work_date + p_workplace.overtime_start) at time zone p_workplace.timezone;
    v_ot_from := greatest(v_in.occurred_at, v_threshold);
    if p_occurred_at > v_ot_from then
      v_overtime_minutes := floor(extract(epoch from (p_occurred_at - v_ot_from)) / 60.0)::integer;
      v_granted := round(
        v_overtime_minutes * p_workplace.comp_leave_ratio_leave_minutes::numeric
        / p_workplace.comp_leave_ratio_overtime_minutes
      )::integer;
    end if;
  else
    v_work_date := (p_occurred_at at time zone p_workplace.timezone)::date;
  end if;

  insert into public.attendance_events (
    organization_id, workplace_id, user_id, event_type, occurred_at, work_date, source, pair_event_id, summary
  ) values (
    p_workplace.organization_id, p_workplace.id, p_user_id, 'out', p_occurred_at, v_work_date,
    p_source, p_pair_id, '{}'::jsonb
  )
  returning id into v_event_id;

  if v_granted > 0 then
    insert into public.leave_ledger (
      organization_id, user_id, leave_type, delta_minutes, reason, ref_table, ref_id, work_date
    ) values (
      p_workplace.organization_id, p_user_id, 'comp', v_granted, '야근 보상휴가',
      'attendance_events', v_event_id, v_work_date
    );
  end if;

  v_summary := jsonb_build_object(
    'status', 'recorded',
    'action', 'out',
    'occurred_at', p_occurred_at,
    'work_date', v_work_date,
    'workplace_id', p_workplace.id,
    'workplace_name', p_workplace.name,
    'late_minutes', 0,
    'penalty_type', null,
    'fine_amount', 0,
    'leave_minutes_deducted', 0,
    'overtime_minutes', v_overtime_minutes,
    'comp_leave_minutes_granted', v_granted,
    'event_id', v_event_id,
    'notice', null
  );

  update public.attendance_events set summary = v_summary where id = v_event_id;
  return v_summary;
end;
$$;

create or replace function public.record_attendance(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_wp public.workplaces;
  v_recent public.attendance_events;
  v_last public.attendance_events;
  v_has_last boolean := false;
  v_now timestamptz := now();
  v_local timestamp;
  v_today date;
  v_close_shift boolean := false;
  v_notice text := null;
  v_summary jsonb;
begin
  if v_uid is null then
    raise exception '로그인이 필요합니다';
  end if;
  if coalesce(trim(p_token), '') = '' then
    raise exception '출퇴근 태그가 없습니다';
  end if;

  select * into v_wp from public.workplaces where nfc_token = p_token;
  if not found then
    raise exception '등록되지 않은 출퇴근 태그입니다';
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  if not found or v_profile.organization_id is null or v_profile.organization_id <> v_wp.organization_id then
    raise exception '이 사업장에 출퇴근할 수 없는 계정입니다';
  end if;

  perform pg_advisory_xact_lock(hashtext('attendance'), hashtext(v_uid::text));

  select * into v_recent
  from public.attendance_events
  where user_id = v_uid
    and workplace_id = v_wp.id
    and voided_at is null
    and occurred_at > v_now - interval '60 seconds'
  order by occurred_at desc
  limit 1;

  if found then
    return coalesce(v_recent.summary, '{}'::jsonb) || jsonb_build_object('status', 'debounced');
  end if;

  select * into v_last
  from public.attendance_events
  where user_id = v_uid and voided_at is null
  order by occurred_at desc, created_at desc
  limit 1;
  v_has_last := found;

  v_local := v_now at time zone v_wp.timezone;
  v_today := v_local::date;

  if v_has_last and v_last.event_type = 'in' then
    if v_last.work_date = v_today
      or (v_last.work_date = v_today - 1 and v_local::time < v_wp.work_start) then
      v_close_shift := true;
    else
      v_notice := 'open_shift_left';
    end if;
  end if;

  if v_close_shift then
    v_summary := public.apply_clock_out(v_uid, v_wp, v_now, 'nfc', v_last.id);
  else
    v_summary := public.apply_clock_in(v_uid, v_wp, v_now, 'nfc');
    if v_notice is not null then
      v_summary := v_summary || jsonb_build_object('notice', v_notice);
      update public.attendance_events
      set summary = v_summary
      where id = (v_summary ->> 'event_id')::uuid;
    end if;
  end if;

  return v_summary;
end;
$$;

create or replace function public.admin_add_attendance_event(
  p_user_id uuid,
  p_workplace_id uuid,
  p_event_type text,
  p_occurred_at timestamptz,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wp public.workplaces;
  v_user public.profiles;
  v_pair uuid;
  v_summary jsonb;
begin
  if not public.is_admin() then
    raise exception '관리자만 출퇴근을 보정할 수 있습니다';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception '수정 사유를 입력하세요';
  end if;
  if p_event_type not in ('in', 'out') then
    raise exception '출근 또는 퇴근만 기록할 수 있습니다';
  end if;
  if p_occurred_at is null then
    raise exception '시각을 입력하세요';
  end if;

  select * into v_user
  from public.profiles
  where id = p_user_id and organization_id = public.current_org_id();
  if not found then
    raise exception '구성원을 찾을 수 없습니다';
  end if;

  select * into v_wp
  from public.workplaces
  where id = p_workplace_id and organization_id = public.current_org_id();
  if not found then
    raise exception '사업장을 찾을 수 없습니다';
  end if;

  perform pg_advisory_xact_lock(hashtext('attendance'), hashtext(p_user_id::text));

  if p_event_type = 'in' then
    v_summary := public.apply_clock_in(p_user_id, v_wp, p_occurred_at, 'manual');
  else
    select e.id into v_pair
    from public.attendance_events e
    where e.user_id = p_user_id
      and e.voided_at is null
      and e.event_type = 'in'
      and e.occurred_at <= p_occurred_at
      and not exists (
        select 1
        from public.attendance_events o
        where o.pair_event_id = e.id
          and o.voided_at is null
          and o.event_type = 'out'
      )
    order by e.occurred_at desc
    limit 1;

    v_summary := public.apply_clock_out(p_user_id, v_wp, p_occurred_at, 'manual', v_pair);
  end if;

  insert into public.attendance_adjustments (
    organization_id, actor_id, user_id, workplace_id, action, event_id, note, payload
  ) values (
    v_wp.organization_id,
    auth.uid(),
    p_user_id,
    p_workplace_id,
    'add_event',
    (v_summary ->> 'event_id')::uuid,
    trim(p_note),
    jsonb_build_object('event_type', p_event_type, 'occurred_at', p_occurred_at)
  );

  return v_summary;
end;
$$;

create or replace function public.admin_void_attendance_event(
  p_event_id uuid,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.attendance_events;
begin
  if not public.is_admin() then
    raise exception '관리자만 출퇴근을 취소할 수 있습니다';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception '수정 사유를 입력하세요';
  end if;

  select * into v_event
  from public.attendance_events
  where id = p_event_id and organization_id = public.current_org_id();
  if not found then
    raise exception '출퇴근 기록을 찾을 수 없습니다';
  end if;
  if v_event.voided_at is not null then
    raise exception '이미 취소된 기록입니다';
  end if;
  if exists (
    select 1 from public.attendance_events
    where pair_event_id = p_event_id and voided_at is null
  ) then
    raise exception '연결된 퇴근 기록을 먼저 취소하세요';
  end if;

  perform pg_advisory_xact_lock(hashtext('attendance'), hashtext(v_event.user_id::text));

  update public.attendance_events set voided_at = now() where id = p_event_id;
  update public.late_penalties set voided_at = now()
  where attendance_event_id = p_event_id and voided_at is null;

  insert into public.leave_ledger (
    organization_id, user_id, leave_type, delta_minutes, reason, ref_table, ref_id, work_date, created_by
  )
  select
    organization_id, user_id, leave_type, -delta_minutes, '출퇴근 기록 취소',
    'attendance_events', p_event_id, work_date, auth.uid()
  from public.leave_ledger
  where ref_id = p_event_id
    and ref_table = 'attendance_events'
    and reason <> '출퇴근 기록 취소';

  insert into public.attendance_adjustments (
    organization_id, actor_id, user_id, workplace_id, action, event_id, note
  ) values (
    v_event.organization_id, auth.uid(), v_event.user_id, v_event.workplace_id,
    'void_event', p_event_id, trim(p_note)
  );
end;
$$;

create or replace function public.admin_adjust_leave(
  p_user_id uuid,
  p_leave_type text,
  p_delta_minutes integer,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  if not public.is_admin() then
    raise exception '관리자만 휴가를 조정할 수 있습니다';
  end if;
  if p_leave_type not in ('annual', 'comp', 'summer') then
    raise exception '휴가 종류가 올바르지 않습니다';
  end if;
  if p_delta_minutes is null or p_delta_minutes = 0 then
    raise exception '조정 시간을 입력하세요';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception '사유를 입력하세요';
  end if;

  select organization_id into v_org
  from public.profiles
  where id = p_user_id and organization_id = public.current_org_id();
  if not found then
    raise exception '구성원을 찾을 수 없습니다';
  end if;

  insert into public.leave_ledger (
    organization_id, user_id, leave_type, delta_minutes, reason, created_by
  ) values (
    v_org, p_user_id, p_leave_type, p_delta_minutes, trim(p_reason), auth.uid()
  );
end;
$$;

create or replace function public.organization_exists()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.organizations);
$$;

create or replace function public.bootstrap_organization(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
begin
  if v_uid is null then
    raise exception '로그인이 필요합니다';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception '조직 이름을 입력하세요';
  end if;

  perform pg_advisory_xact_lock(714203);
  if exists (select 1 from public.organizations) then
    raise exception '조직이 이미 있습니다';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception '프로필을 찾을 수 없습니다';
  end if;

  insert into public.organizations (name) values (trim(p_name)) returning id into v_org;
  perform set_config('app.bypass_profile_guard', 'on', true);
  update public.profiles
  set organization_id = v_org, role = 'admin'
  where id = v_uid;

  return v_org;
end;
$$;

create or replace function public.workplace_nfc_token(p_workplace_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  if not public.is_admin() then
    raise exception '관리자만 태그 주소를 볼 수 있습니다';
  end if;

  select nfc_token into v_token
  from public.workplaces
  where id = p_workplace_id and organization_id = public.current_org_id();
  if not found then
    raise exception '사업장을 찾을 수 없습니다';
  end if;
  return v_token;
end;
$$;

create or replace function public.rotate_nfc_token(p_workplace_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := public.random_token();
begin
  if not public.is_admin() then
    raise exception '관리자만 태그를 재발급할 수 있습니다';
  end if;
  if not exists (
    select 1 from public.workplaces
    where id = p_workplace_id and organization_id = public.current_org_id()
  ) then
    raise exception '사업장을 찾을 수 없습니다';
  end if;

  perform set_config('app.allow_token_rotate', 'on', true);
  update public.workplaces set nfc_token = v_token where id = p_workplace_id;
  return v_token;
end;
$$;

create view public.leave_balance_sums
with (security_invoker = true) as
select
  user_id,
  organization_id,
  leave_type,
  sum(delta_minutes)::integer as balance_minutes
from public.leave_ledger
group by user_id, organization_id, leave_type;

alter table public.organizations enable row level security;
alter table public.workplaces enable row level security;
alter table public.profiles enable row level security;
alter table public.attendance_events enable row level security;
alter table public.attendance_adjustments enable row level security;
alter table public.leave_ledger enable row level security;
alter table public.late_penalties enable row level security;

create policy organizations_select on public.organizations
  for select to authenticated
  using (id = public.current_org_id());

create policy organizations_update on public.organizations
  for update to authenticated
  using (id = public.current_org_id() and public.is_admin())
  with check (id = public.current_org_id() and public.is_admin());

create policy workplaces_select on public.workplaces
  for select to authenticated
  using (organization_id = public.current_org_id());

create policy workplaces_insert on public.workplaces
  for insert to authenticated
  with check (organization_id = public.current_org_id() and public.is_admin());

create policy workplaces_update on public.workplaces
  for update to authenticated
  using (organization_id = public.current_org_id() and public.is_admin())
  with check (organization_id = public.current_org_id() and public.is_admin());

create policy workplaces_delete on public.workplaces
  for delete to authenticated
  using (organization_id = public.current_org_id() and public.is_admin());

create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or (organization_id = public.current_org_id() and public.is_admin())
  );

create policy profiles_update on public.profiles
  for update to authenticated
  using (
    id = auth.uid()
    or (organization_id = public.current_org_id() and public.is_admin())
  )
  with check (
    id = auth.uid()
    or (organization_id = public.current_org_id() and public.is_admin())
  );

create policy attendance_events_select on public.attendance_events
  for select to authenticated
  using (
    organization_id = public.current_org_id()
    and (user_id = auth.uid() or public.is_admin())
  );

create policy attendance_adjustments_select on public.attendance_adjustments
  for select to authenticated
  using (organization_id = public.current_org_id() and public.is_admin());

create policy leave_ledger_select on public.leave_ledger
  for select to authenticated
  using (
    organization_id = public.current_org_id()
    and (user_id = auth.uid() or public.is_admin())
  );

create policy late_penalties_select on public.late_penalties
  for select to authenticated
  using (
    organization_id = public.current_org_id()
    and (user_id = auth.uid() or public.is_admin())
  );

revoke all on table public.organizations from anon, authenticated;
revoke all on table public.workplaces from anon, authenticated;
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.attendance_events from anon, authenticated;
revoke all on table public.attendance_adjustments from anon, authenticated;
revoke all on table public.leave_ledger from anon, authenticated;
revoke all on table public.late_penalties from anon, authenticated;
revoke all on table public.leave_balance_sums from anon, authenticated;

grant select, update on table public.organizations to authenticated;
grant select (
  id, organization_id, name, address, timezone, work_start, work_end,
  late_grace_minutes, late_policy, fine_mode, fine_amount, leave_deduction_mode,
  leave_deduction_minutes, overtime_start, comp_leave_ratio_overtime_minutes,
  comp_leave_ratio_leave_minutes, created_at, updated_at
) on table public.workplaces to authenticated;
grant insert, update, delete on table public.workplaces to authenticated;
grant select, update on table public.profiles to authenticated;
grant select on table public.attendance_events to authenticated;
grant select on table public.attendance_adjustments to authenticated;
grant select on table public.leave_ledger to authenticated;
grant select on table public.late_penalties to authenticated;
grant select on table public.leave_balance_sums to authenticated;

revoke all on function public.random_token() from public, anon, authenticated;
revoke all on function public.current_org_id() from public, anon;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.current_org_id() to authenticated;
grant execute on function public.is_admin() to authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.workplaces_guard() from public, anon, authenticated;
revoke all on function public.profiles_guard() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.apply_clock_in(uuid, public.workplaces, timestamptz, text) from public, anon, authenticated;
revoke all on function public.apply_clock_out(uuid, public.workplaces, timestamptz, text, uuid) from public, anon, authenticated;

revoke all on function public.record_attendance(text) from public, anon;
revoke all on function public.admin_add_attendance_event(uuid, uuid, text, timestamptz, text) from public, anon;
revoke all on function public.admin_void_attendance_event(uuid, text) from public, anon;
revoke all on function public.admin_adjust_leave(uuid, text, integer, text) from public, anon;
revoke all on function public.organization_exists() from public, anon;
revoke all on function public.bootstrap_organization(text) from public, anon;
revoke all on function public.workplace_nfc_token(uuid) from public, anon;
revoke all on function public.rotate_nfc_token(uuid) from public, anon;

grant execute on function public.record_attendance(text) to authenticated;
grant execute on function public.admin_add_attendance_event(uuid, uuid, text, timestamptz, text) to authenticated;
grant execute on function public.admin_void_attendance_event(uuid, text) to authenticated;
grant execute on function public.admin_adjust_leave(uuid, text, integer, text) to authenticated;
grant execute on function public.organization_exists() to authenticated;
grant execute on function public.bootstrap_organization(text) to authenticated;
grant execute on function public.workplace_nfc_token(uuid) to authenticated;
grant execute on function public.rotate_nfc_token(uuid) to authenticated;
