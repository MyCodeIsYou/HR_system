-- 신청 종류와 휴가 신청의 일수에서 0.25일(120분) 단위 제한을 뺀다.
-- 0보다 크고 30일(14400분) 이하인 정수 분만 허용한다.

do $$
declare
  v_name text;
begin
  for v_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.leave_kinds'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%minutes%'
  loop
    execute format('alter table public.leave_kinds drop constraint %I', v_name);
  end loop;

  for v_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.leave_requests'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%minutes%'
  loop
    execute format('alter table public.leave_requests drop constraint %I', v_name);
  end loop;
end $$;

alter table public.leave_kinds
  add constraint leave_kinds_minutes_check
  check (minutes > 0 and minutes <= 14400);

alter table public.leave_requests
  add constraint leave_requests_minutes_check
  check (minutes > 0 and minutes <= 14400);
