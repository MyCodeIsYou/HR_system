-- 구성원이 날짜를 골라 휴가를 신청한다.
-- 대기 중인 신청은 잔여에서 미리 빼 두고, 승인되면 휴가 원장에 차감이 남는다.

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  leave_type text not null check (leave_type in ('annual', 'comp', 'summer')),
  work_date date not null,
  minutes integer not null check (minutes in (120, 240, 480)),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  note text not null default '',
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index leave_requests_one_open_day
  on public.leave_requests (user_id, work_date)
  where status in ('pending', 'approved');

create index leave_requests_org_status_idx
  on public.leave_requests (organization_id, status, work_date);

alter table public.leave_requests enable row level security;

create policy leave_requests_select on public.leave_requests
  for select to authenticated
  using (
    organization_id = public.current_org_id()
    and (user_id = auth.uid() or public.is_admin())
  );

grant select on table public.leave_requests to authenticated;

create or replace function public.request_leave(
  p_leave_type text,
  p_work_date date,
  p_minutes integer,
  p_note text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_balance integer;
  v_held integer;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다';
  end if;
  if p_leave_type not in ('annual', 'comp', 'summer') then
    raise exception '휴가 종류가 올바르지 않습니다';
  end if;
  if p_minutes not in (120, 240, 480) then
    raise exception '휴가는 1일, 0.5일, 0.25일 단위입니다';
  end if;
  if p_work_date is null then
    raise exception '날짜를 선택하세요';
  end if;

  select organization_id into v_org
  from public.profiles
  where id = auth.uid();
  if v_org is null then
    raise exception '조직이 없습니다';
  end if;

  select coalesce(sum(delta_minutes), 0) into v_balance
  from public.leave_ledger
  where user_id = auth.uid() and leave_type = p_leave_type;

  select coalesce(sum(minutes), 0) into v_held
  from public.leave_requests
  where user_id = auth.uid()
    and leave_type = p_leave_type
    and status = 'pending';

  if v_balance < v_held + p_minutes then
    raise exception '남은 휴가가 부족합니다';
  end if;

  begin
    insert into public.leave_requests (
      organization_id, user_id, leave_type, work_date, minutes, note
    ) values (
      v_org, auth.uid(), p_leave_type, p_work_date, p_minutes, coalesce(trim(p_note), '')
    )
    returning id into v_id;
  exception
    when unique_violation then
      raise exception '그 날짜에는 이미 휴가가 있습니다';
  end;

  return v_id;
end;
$$;

create or replace function public.cancel_leave_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다';
  end if;

  update public.leave_requests
  set status = 'cancelled'
  where id = p_id
    and user_id = auth.uid()
    and status = 'pending';

  if not found then
    raise exception '취소할 수 있는 신청이 없습니다';
  end if;
end;
$$;

create or replace function public.review_leave_request(p_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.leave_requests;
  v_balance integer;
begin
  if not public.is_admin() then
    raise exception '관리자만 휴가 신청을 처리할 수 있습니다';
  end if;

  select * into v_req
  from public.leave_requests
  where id = p_id
    and organization_id = public.current_org_id()
    and status = 'pending'
  for update;

  if not found then
    raise exception '대기 중인 신청을 찾을 수 없습니다';
  end if;

  if p_approve then
    select coalesce(sum(delta_minutes), 0) into v_balance
    from public.leave_ledger
    where user_id = v_req.user_id and leave_type = v_req.leave_type;

    if v_balance < v_req.minutes then
      raise exception '남은 휴가가 부족합니다';
    end if;

    insert into public.leave_ledger (
      organization_id, user_id, leave_type, delta_minutes, reason, ref_table, ref_id, work_date, created_by
    ) values (
      v_req.organization_id, v_req.user_id, v_req.leave_type, -v_req.minutes,
      '휴가 신청', 'leave_requests', v_req.id, v_req.work_date, auth.uid()
    );

    update public.leave_requests
    set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
    where id = v_req.id;
  else
    update public.leave_requests
    set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
    where id = v_req.id;
  end if;
end;
$$;

revoke all on function public.request_leave(text, date, integer, text) from public, anon;
revoke all on function public.cancel_leave_request(uuid) from public, anon;
revoke all on function public.review_leave_request(uuid, boolean) from public, anon;

grant execute on function public.request_leave(text, date, integer, text) to authenticated;
grant execute on function public.cancel_leave_request(uuid) to authenticated;
grant execute on function public.review_leave_request(uuid, boolean) to authenticated;
