do $$
declare
  v_name text;
begin
  select con.conname into v_name
  from pg_constraint con
  where con.conrelid = 'public.leave_ledger'::regclass
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%leave_type%';
  if v_name is not null then
    execute format('alter table public.leave_ledger drop constraint %I', v_name);
  end if;
end $$;

alter table public.leave_ledger
  add constraint leave_ledger_leave_type_check
  check (leave_type in ('annual', 'comp', 'summer'));

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
