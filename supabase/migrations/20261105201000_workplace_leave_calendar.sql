-- 같은 사업장 구성원이 서로의 휴가 일정을 이름과 함께 볼 수 있게 한다.
-- 프로필 전체는 열지 않고, 이 함수가 이름과 일정만 돌려준다.

create or replace function public.workplace_leaves(p_from date, p_to date)
returns table (
  id uuid,
  user_id uuid,
  name text,
  work_date date,
  minutes integer,
  status text,
  kind_name text,
  leave_type text,
  entry_mode text,
  note text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_workplace uuid;
begin
  if p_from is null or p_to is null or p_to < p_from or (p_to - p_from) > 62 then
    raise exception '조회 기간을 확인해 주세요.';
  end if;

  select organization_id, workplace_id
    into v_org, v_workplace
  from public.profiles
  where profiles.id = auth.uid();

  if v_org is null then
    return;
  end if;

  return query
  select
    r.id,
    r.user_id,
    p.name,
    r.work_date,
    r.minutes,
    r.status,
    r.kind_name,
    r.leave_type,
    r.entry_mode,
    case when r.user_id = auth.uid() then r.note else '' end
  from public.leave_requests r
  join public.profiles p on p.id = r.user_id
  where r.organization_id = v_org
    and r.status in ('pending', 'approved')
    and r.work_date between p_from and p_to
    and (
      r.user_id = auth.uid()
      or (v_workplace is not null and p.workplace_id = v_workplace)
    )
  order by r.work_date, p.name, r.created_at;
end $$;

revoke all on function public.workplace_leaves(date, date) from public, anon;
grant execute on function public.workplace_leaves(date, date) to authenticated;
