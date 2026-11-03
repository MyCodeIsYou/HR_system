alter table public.profiles add column if not exists job_title text;

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
