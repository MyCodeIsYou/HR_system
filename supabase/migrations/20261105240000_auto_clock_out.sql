-- 자정까지 퇴근이 없는 출근은 사업장 기준 퇴근 시각으로 닫는다.
-- 다음 날 태그는 전날 퇴근이 되지 않고 새 출근이 된다.
-- pg_cron 시간대는 GMT이므로 매일 15:00 UTC = 한국 시간 00:00이다.

do $$
declare
  v_name text;
begin
  for v_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.attendance_events'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%source%'
  loop
    execute format('alter table public.attendance_events drop constraint %I', v_name);
  end loop;
end $$;

alter table public.attendance_events
  add constraint attendance_events_source_check
  check (source in ('nfc', 'manual', 'auto'));

create or replace function public.close_forgotten_clock_outs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_in public.attendance_events;
  v_wp public.workplaces;
  v_out_at timestamptz;
  v_count integer := 0;
begin
  for v_in in
    select e.*
    from public.attendance_events e
    where e.event_type = 'in'
      and e.voided_at is null
      and not exists (
        select 1
        from public.attendance_events o
        where o.pair_event_id = e.id
          and o.event_type = 'out'
          and o.voided_at is null
      )
    order by e.occurred_at
  loop
    select * into v_wp from public.workplaces where id = v_in.workplace_id;
    if not found then
      continue;
    end if;
    if (((v_in.work_date + 1) + time '00:00') at time zone v_wp.timezone) > now() then
      continue;
    end if;

    perform pg_advisory_xact_lock(hashtext('attendance'), hashtext(v_in.user_id::text));
    if exists (
      select 1
      from public.attendance_events o
      where o.pair_event_id = v_in.id
        and o.event_type = 'out'
        and o.voided_at is null
    ) then
      continue;
    end if;

    v_out_at := (v_in.work_date + v_wp.work_end) at time zone v_wp.timezone;
    if v_out_at < v_in.occurred_at then
      v_out_at := v_in.occurred_at;
    end if;

    perform public.apply_clock_out(v_in.user_id, v_wp, v_out_at, 'auto', v_in.id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;

create or replace function public.record_attendance(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_wp public.workplaces;
  v_recent public.attendance_events;
  v_last public.attendance_events;
  v_has_last boolean := false;
  v_now timestamptz := now();
  v_local timestamp;
  v_today date;
  v_close_shift boolean := false;
  v_notice text := null;
  v_summary jsonb;
begin
  if v_uid is null then
    raise exception '로그인이 필요합니다';
  end if;
  if coalesce(trim(p_token), '') = '' then
    raise exception '출퇴근 태그가 없습니다';
  end if;

  select * into v_wp from public.workplaces where nfc_token = p_token;
  if not found then
    raise exception '등록되지 않은 출퇴근 태그입니다';
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  if not found or v_profile.organization_id is null or v_profile.organization_id <> v_wp.organization_id then
    raise exception '이 사업장에 출퇴근할 수 없는 계정입니다';
  end if;

  perform pg_advisory_xact_lock(hashtext('attendance'), hashtext(v_uid::text));

  select * into v_recent
  from public.attendance_events
  where user_id = v_uid
    and workplace_id = v_wp.id
    and voided_at is null
    and occurred_at > v_now - interval '60 seconds'
  order by occurred_at desc
  limit 1;

  if found then
    return coalesce(v_recent.summary, '{}'::jsonb) || jsonb_build_object('status', 'debounced');
  end if;

  select * into v_last
  from public.attendance_events
  where user_id = v_uid and voided_at is null
  order by occurred_at desc, created_at desc
  limit 1;
  v_has_last := found;

  v_local := v_now at time zone v_wp.timezone;
  v_today := v_local::date;

  if v_has_last and v_last.event_type = 'in' and v_last.work_date = v_today then
    v_close_shift := true;
  elsif v_has_last and v_last.event_type = 'in' then
    v_notice := 'open_shift_left';
  end if;

  if v_close_shift then
    v_summary := public.apply_clock_out(v_uid, v_wp, v_now, 'nfc', v_last.id);
  else
    v_summary := public.apply_clock_in(v_uid, v_wp, v_now, 'nfc');
    if v_notice is not null then
      v_summary := v_summary || jsonb_build_object('notice', v_notice);
      update public.attendance_events
      set summary = v_summary
      where id = (v_summary ->> 'event_id')::uuid;
    end if;
  end if;

  return v_summary;
end;
$$;

revoke all on function public.close_forgotten_clock_outs() from public, anon, authenticated;
revoke all on function public.record_attendance(text) from public, anon;

do $$
declare
  v_job bigint;
begin
  select jobid into v_job from cron.job where jobname = 'auto-clock-out';
  if v_job is not null then
    perform cron.unschedule(v_job);
  end if;
end $$;

select cron.schedule(
  'auto-clock-out',
  '0 15 * * *',
  $$select public.close_forgotten_clock_outs();$$
);
