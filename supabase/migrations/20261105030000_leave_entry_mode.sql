-- 휴가 관리를 신청형과 등록형으로 나눈다.
-- 등록형은 구성원이 승인 없이 등록하고, 바로 휴가 원장에서 차감된다.

alter table public.organizations
  add column if not exists leave_entry_mode text not null default 'request';

alter table public.organizations drop constraint if exists organizations_leave_entry_mode_check;
alter table public.organizations
  add constraint organizations_leave_entry_mode_check
  check (leave_entry_mode in ('request', 'register'));

alter table public.leave_requests
  add column if not exists entry_mode text not null default 'request';

alter table public.leave_requests drop constraint if exists leave_requests_entry_mode_check;
alter table public.leave_requests
  add constraint leave_requests_entry_mode_check
  check (entry_mode in ('request', 'register'));

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
  v_mode text;
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

  select leave_entry_mode into v_mode
  from public.organizations
  where id = v_org;
  if v_mode is null then
    v_mode := 'request';
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
      organization_id, user_id, leave_type, work_date, minutes, note, status, entry_mode, reviewed_at
    ) values (
      v_org,
      auth.uid(),
      p_leave_type,
      p_work_date,
      p_minutes,
      coalesce(trim(p_note), ''),
      case when v_mode = 'register' then 'approved' else 'pending' end,
      v_mode,
      case when v_mode = 'register' then now() else null end
    )
    returning id into v_id;
  exception
    when unique_violation then
      raise exception '그 날짜에는 이미 휴가가 있습니다';
  end;

  if v_mode = 'register' then
    insert into public.leave_ledger (
      organization_id, user_id, leave_type, delta_minutes, reason, ref_table, ref_id, work_date, created_by
    ) values (
      v_org, auth.uid(), p_leave_type, -p_minutes,
      '휴가 등록', 'leave_requests', v_id, p_work_date, auth.uid()
    );
  end if;

  return v_id;
end;
$$;

create or replace function public.cancel_leave_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.leave_requests;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다';
  end if;

  select * into v_req
  from public.leave_requests
  where id = p_id
    and user_id = auth.uid()
  for update;

  if not found then
    raise exception '취소할 수 있는 신청이 없습니다';
  end if;

  if v_req.status = 'pending' then
    update public.leave_requests
    set status = 'cancelled'
    where id = v_req.id;
  elsif v_req.status = 'approved' and v_req.entry_mode = 'register' then
    insert into public.leave_ledger (
      organization_id, user_id, leave_type, delta_minutes, reason, ref_table, ref_id, work_date, created_by
    ) values (
      v_req.organization_id, v_req.user_id, v_req.leave_type, v_req.minutes,
      '휴가 등록 취소', 'leave_requests', v_req.id, v_req.work_date, auth.uid()
    );
    update public.leave_requests
    set status = 'cancelled'
    where id = v_req.id;
  else
    raise exception '취소할 수 있는 신청이 없습니다';
  end if;
end;
$$;
