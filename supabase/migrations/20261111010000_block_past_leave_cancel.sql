-- 지난 날짜의 휴가는 본인이 취소할 수 없다. 관리자는 날짜와 관계없이 조직의 휴가를 취소할 수 있다.

create or replace function public.cancel_leave_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.leave_requests;
  v_admin boolean;
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
    if v_req.leave_type is not null then
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
