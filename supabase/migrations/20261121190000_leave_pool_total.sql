-- 휴가를 쓸 때 연차, 보상휴가, 여름휴가 합계를 본다.
-- 차감은 연차, 보상휴가, 여름휴가 순으로 남은 만큼만 가져간다.

create or replace function public.leave_pool_minutes(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(delta_minutes), 0)::integer
  from public.leave_ledger
  where user_id = p_user
    and leave_type in ('annual', 'comp', 'summer');
$$;

create or replace function public.spend_leave_pool(
  p_org uuid,
  p_user uuid,
  p_minutes integer,
  p_reason text,
  p_ref_id uuid,
  p_work_date date,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
  v_have integer;
  v_take integer;
  v_left integer := p_minutes;
begin
  if p_minutes is null or p_minutes <= 0 then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_user::text), hashtext('leave-pool'));

  foreach v_type in array array['annual', 'comp', 'summer']
  loop
    exit when v_left <= 0;

    select coalesce(sum(delta_minutes), 0) into v_have
    from public.leave_ledger
    where user_id = p_user
      and leave_type = v_type;

    if v_have <= 0 then
      continue;
    end if;

    v_take := least(v_have, v_left);
    insert into public.leave_ledger (
      organization_id, user_id, leave_type, delta_minutes, reason, ref_table, ref_id, work_date, created_by
    ) values (
      p_org, p_user, v_type, -v_take, p_reason, 'leave_requests', p_ref_id, p_work_date, p_actor
    );
    v_left := v_left - v_take;
  end loop;

  if v_left > 0 then
    raise exception '남은 휴가가 부족합니다';
  end if;
end;
$$;

create or replace function public.request_leave(
  p_kind_id uuid,
  p_work_date date,
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
  v_kind public.leave_kinds;
  v_held integer;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다';
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

  select * into v_kind
  from public.leave_kinds
  where id = p_kind_id
    and organization_id = v_org
    and enabled;
  if not found then
    raise exception '사용할 수 없는 휴가 종류입니다';
  end if;

  select leave_entry_mode into v_mode
  from public.organizations
  where id = v_org;
  if v_mode is null then
    v_mode := 'request';
  end if;

  if v_kind.deduct_type is not null then
    perform pg_advisory_xact_lock(hashtext(auth.uid()::text), hashtext('leave-pool'));

    select coalesce(sum(minutes), 0) into v_held
    from public.leave_requests
    where user_id = auth.uid()
      and leave_type in ('annual', 'comp', 'summer')
      and status = 'pending';

    if public.leave_pool_minutes(auth.uid()) < v_held + v_kind.minutes then
      raise exception '남은 휴가가 부족합니다';
    end if;
  end if;

  begin
    insert into public.leave_requests (
      organization_id, user_id, leave_type, work_date, minutes, note, status, entry_mode, reviewed_at, kind_id, kind_name
    ) values (
      v_org,
      auth.uid(),
      v_kind.deduct_type,
      p_work_date,
      v_kind.minutes,
      coalesce(btrim(p_note), ''),
      case when v_mode = 'register' then 'approved' else 'pending' end,
      v_mode,
      case when v_mode = 'register' then now() else null end,
      v_kind.id,
      btrim(v_kind.name)
    )
    returning id into v_id;
  exception
    when unique_violation then
      raise exception '그 날짜에는 이미 휴가가 있습니다';
  end;

  if v_mode = 'register' and v_kind.deduct_type is not null then
    perform public.spend_leave_pool(
      v_org, auth.uid(), v_kind.minutes, btrim(v_kind.name), v_id, p_work_date, auth.uid()
    );
  end if;

  return v_id;
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
  v_held integer;
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
    if v_req.leave_type is not null then
      perform pg_advisory_xact_lock(hashtext(v_req.user_id::text), hashtext('leave-pool'));

      select coalesce(sum(minutes), 0) into v_held
      from public.leave_requests
      where user_id = v_req.user_id
        and id <> v_req.id
        and leave_type in ('annual', 'comp', 'summer')
        and status = 'pending';

      if public.leave_pool_minutes(v_req.user_id) < v_req.minutes + v_held then
        raise exception '남은 휴가가 부족합니다';
      end if;

      perform public.spend_leave_pool(
        v_req.organization_id,
        v_req.user_id,
        v_req.minutes,
        coalesce(v_req.kind_name, '휴가 신청'),
        v_req.id,
        v_req.work_date,
        auth.uid()
      );
    end if;

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

create or replace function public.cancel_leave_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.leave_requests;
  v_admin boolean;
  v_restored integer := 0;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다';
  end if;

  v_admin := public.is_admin();

  select * into v_req
  from public.leave_requests
  where id = p_id
    and (
      user_id = auth.uid()
      or (v_admin and organization_id = public.current_org_id())
    )
  for update;

  if not found then
    raise exception '취소할 수 있는 신청이 없습니다';
  end if;

  if v_req.work_date < (timezone('Asia/Seoul', now()))::date and not v_admin then
    raise exception '지난 날의 휴가는 취소할 수 없습니다';
  end if;

  if v_req.status = 'pending' then
    update public.leave_requests
    set status = 'cancelled'
    where id = v_req.id;
  elsif v_req.status = 'approved' and (v_req.entry_mode = 'register' or v_admin) then
    insert into public.leave_ledger (
      organization_id, user_id, leave_type, delta_minutes, reason, ref_table, ref_id, work_date, created_by
    )
    select
      ledger.organization_id,
      ledger.user_id,
      ledger.leave_type,
      -ledger.delta_minutes,
      coalesce(v_req.kind_name, '휴가') || ' 취소',
      'leave_requests',
      v_req.id,
      v_req.work_date,
      auth.uid()
    from public.leave_ledger ledger
    where ledger.ref_table = 'leave_requests'
      and ledger.ref_id = v_req.id
      and ledger.delta_minutes < 0;

    get diagnostics v_restored = row_count;

    if v_restored = 0 and v_req.leave_type is not null then
      insert into public.leave_ledger (
        organization_id, user_id, leave_type, delta_minutes, reason, ref_table, ref_id, work_date, created_by
      ) values (
        v_req.organization_id, v_req.user_id, v_req.leave_type, v_req.minutes,
        coalesce(v_req.kind_name, '휴가') || ' 취소', 'leave_requests', v_req.id, v_req.work_date, auth.uid()
      );
    end if;

    update public.leave_requests
    set status = 'cancelled'
    where id = v_req.id;
  else
    raise exception '취소할 수 있는 신청이 없습니다';
  end if;
end;
$$;

revoke all on function public.leave_pool_minutes(uuid) from public, anon, authenticated;
revoke all on function public.spend_leave_pool(uuid, uuid, integer, text, uuid, date, uuid) from public, anon, authenticated;
revoke all on function public.request_leave(uuid, date, text) from public, anon;
grant execute on function public.request_leave(uuid, date, text) to authenticated;
