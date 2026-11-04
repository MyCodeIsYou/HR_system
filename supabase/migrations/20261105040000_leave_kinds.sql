-- 신청 종류를 조직마다 관리한다.
-- 종류는 이름, 일수, 차감 대상을 가진다. 차감 대상이 없으면 원장을 건드리지 않는다.

create table if not exists public.leave_kinds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(btrim(name)) > 0),
  minutes integer not null check (minutes > 0 and minutes % 120 = 0 and minutes <= 14400),
  deduct_type text check (deduct_type in ('annual', 'comp', 'summer')),
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists leave_kinds_org_name_uidx
  on public.leave_kinds (organization_id, lower(btrim(name)));

alter table public.leave_requests
  add column if not exists kind_id uuid references public.leave_kinds (id) on delete restrict,
  add column if not exists kind_name text;

do $$
declare
  v_name text;
begin
  for v_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.leave_requests'::regclass
      and con.contype = 'c'
      and (
        pg_get_constraintdef(con.oid) ilike '%leave_type%'
        or pg_get_constraintdef(con.oid) ilike '%minutes%'
      )
  loop
    execute format('alter table public.leave_requests drop constraint %I', v_name);
  end loop;
end $$;

alter table public.leave_requests alter column leave_type drop not null;

alter table public.leave_requests
  add constraint leave_requests_leave_type_check
  check (leave_type is null or leave_type in ('annual', 'comp', 'summer'));

alter table public.leave_requests
  add constraint leave_requests_minutes_check
  check (minutes > 0 and minutes % 120 = 0 and minutes <= 14400);

create or replace function public.seed_default_leave_kinds()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.leave_kinds (organization_id, name, minutes, deduct_type, sort_order)
  select new.id, seed.name, seed.minutes, seed.deduct_type, seed.sort_order
  from (
    values
      ('휴가', 480, 'annual'::text, 1),
      ('반차', 240, 'annual', 2),
      ('반반차', 120, 'annual', 3),
      ('경조사휴가', 480, null::text, 4)
  ) as seed(name, minutes, deduct_type, sort_order)
  where not exists (
    select 1
    from public.leave_kinds existing
    where existing.organization_id = new.id
      and lower(btrim(existing.name)) = lower(seed.name)
  );
  return new;
end;
$$;

drop trigger if exists organizations_seed_leave_kinds on public.organizations;
create trigger organizations_seed_leave_kinds
  after insert on public.organizations
  for each row
  execute function public.seed_default_leave_kinds();

insert into public.leave_kinds (organization_id, name, minutes, deduct_type, sort_order)
select organization.id, seed.name, seed.minutes, seed.deduct_type, seed.sort_order
from public.organizations organization
cross join (
  values
    ('휴가', 480, 'annual'::text, 1),
    ('반차', 240, 'annual', 2),
    ('반반차', 120, 'annual', 3),
    ('경조사휴가', 480, null::text, 4)
) as seed(name, minutes, deduct_type, sort_order)
where not exists (
  select 1
  from public.leave_kinds existing
  where existing.organization_id = organization.id
    and lower(btrim(existing.name)) = lower(seed.name)
);

alter table public.leave_kinds enable row level security;

drop policy if exists leave_kinds_select on public.leave_kinds;
create policy leave_kinds_select on public.leave_kinds
  for select to authenticated
  using (organization_id = public.current_org_id());

drop policy if exists leave_kinds_insert on public.leave_kinds;
create policy leave_kinds_insert on public.leave_kinds
  for insert to authenticated
  with check (organization_id = public.current_org_id() and public.is_admin());

drop policy if exists leave_kinds_update on public.leave_kinds;
create policy leave_kinds_update on public.leave_kinds
  for update to authenticated
  using (organization_id = public.current_org_id() and public.is_admin())
  with check (organization_id = public.current_org_id() and public.is_admin());

drop policy if exists leave_kinds_delete on public.leave_kinds;
create policy leave_kinds_delete on public.leave_kinds
  for delete to authenticated
  using (organization_id = public.current_org_id() and public.is_admin());

revoke all on table public.leave_kinds from anon, authenticated;
grant select, insert, update, delete on table public.leave_kinds to authenticated;

revoke all on function public.seed_default_leave_kinds() from public, anon, authenticated;

drop function if exists public.request_leave(text, date, integer, text);

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
  v_balance integer;
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
    select coalesce(sum(delta_minutes), 0) into v_balance
    from public.leave_ledger
    where user_id = auth.uid() and leave_type = v_kind.deduct_type;

    select coalesce(sum(minutes), 0) into v_held
    from public.leave_requests
    where user_id = auth.uid()
      and leave_type = v_kind.deduct_type
      and status = 'pending';

    if v_balance < v_held + v_kind.minutes then
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
    insert into public.leave_ledger (
      organization_id, user_id, leave_type, delta_minutes, reason, ref_table, ref_id, work_date, created_by
    ) values (
      v_org, auth.uid(), v_kind.deduct_type, -v_kind.minutes,
      btrim(v_kind.name), 'leave_requests', v_id, p_work_date, auth.uid()
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
    if v_req.leave_type is not null then
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
        coalesce(v_req.kind_name, '휴가 신청'), 'leave_requests', v_req.id, v_req.work_date, auth.uid()
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

revoke all on function public.request_leave(uuid, date, text) from public, anon;
grant execute on function public.request_leave(uuid, date, text) to authenticated;
