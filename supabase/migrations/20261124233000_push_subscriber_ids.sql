-- 관리자가 알림을 켠 구성원을 고를 수 있게, 구독이 있는 사용자만 돌려준다.

create or replace function public.push_subscriber_ids()
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select distinct s.user_id
  from public.push_subscriptions s
  where public.is_admin()
    and s.organization_id = public.current_org_id();
$$;

revoke all on function public.push_subscriber_ids() from public, anon;
grant execute on function public.push_subscriber_ids() to authenticated;
