-- 야근 인정 시각 이후의 출근은 지각이 아니라 그 시각부터의 야근 시작이다.
-- 그날 다른 출근이 없어도 같다. 보상휴가는 퇴근 때 이 출근 시각부터 계산한다.

create or replace function public.apply_clock_in(
  p_user_id uuid,
  p_workplace public.workplaces,
  p_occurred_at timestamptz,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_local timestamp;
  v_work_date date;
  v_start timestamptz;
  v_deadline timestamptz;
  v_late_minutes integer := 0;
  v_fine integer := 0;
  v_deduct integer := 0;
  v_event_id uuid;
  v_summary jsonb;
  v_already boolean;
  v_overtime_at timestamptz;
  v_overtime_started boolean := false;
begin
  v_local := p_occurred_at at time zone p_workplace.timezone;
  v_work_date := v_local::date;
  v_start := (v_work_date + p_workplace.work_start) at time zone p_workplace.timezone;
  v_deadline := v_start + make_interval(mins => p_workplace.late_grace_minutes);
  v_overtime_at := (v_work_date + p_workplace.overtime_start) at time zone p_workplace.timezone;

  select exists (
    select 1
    from public.attendance_events
    where user_id = p_user_id
      and voided_at is null
      and event_type = 'in'
      and work_date = v_work_date
  ) into v_already;

  if p_occurred_at >= v_overtime_at then
    v_overtime_started := true;
  elsif not v_already and p_occurred_at > v_deadline then
    v_late_minutes := ceil(extract(epoch from (p_occurred_at - v_start)) / 60.0)::integer;
  end if;

  if v_late_minutes > 0 and p_workplace.late_policy = 'fine' then
    v_fine := case
      when p_workplace.fine_mode = 'per_minute' then v_late_minutes * p_workplace.fine_amount
      else p_workplace.fine_amount
    end;
  elsif v_late_minutes > 0 and p_workplace.late_policy = 'annual_leave' then
    v_deduct := case
      when p_workplace.leave_deduction_mode = 'per_occurrence' then p_workplace.leave_deduction_minutes
      else v_late_minutes
    end;
  end if;

  insert into public.attendance_events (
    organization_id, workplace_id, user_id, event_type, occurred_at, work_date, source, summary
  ) values (
    p_workplace.organization_id, p_workplace.id, p_user_id, 'in', p_occurred_at, v_work_date, p_source, '{}'::jsonb
  )
  returning id into v_event_id;

  if v_late_minutes > 0 then
    insert into public.late_penalties (
      organization_id, user_id, workplace_id, attendance_event_id, work_date,
      late_minutes, penalty_type, fine_amount, leave_minutes_deducted
    ) values (
      p_workplace.organization_id, p_user_id, p_workplace.id, v_event_id, v_work_date,
      v_late_minutes, p_workplace.late_policy, v_fine, v_deduct
    );

    if v_deduct > 0 then
      insert into public.leave_ledger (
        organization_id, user_id, leave_type, delta_minutes, reason, ref_table, ref_id, work_date
      ) values (
        p_workplace.organization_id, p_user_id, 'annual', -v_deduct, '지각 연차 차감',
        'attendance_events', v_event_id, v_work_date
      );
    end if;
  end if;

  v_summary := jsonb_build_object(
    'status', 'recorded',
    'action', 'in',
    'occurred_at', p_occurred_at,
    'work_date', v_work_date,
    'workplace_id', p_workplace.id,
    'workplace_name', p_workplace.name,
    'late_minutes', v_late_minutes,
    'penalty_type', case when v_late_minutes > 0 then p_workplace.late_policy else null end,
    'fine_amount', v_fine,
    'leave_minutes_deducted', v_deduct,
    'overtime_minutes', 0,
    'comp_leave_minutes_granted', 0,
    'overtime_started', v_overtime_started,
    'event_id', v_event_id,
    'notice', null
  );

  update public.attendance_events set summary = v_summary where id = v_event_id;
  return v_summary;
end;
$$;

revoke all on function public.apply_clock_in(uuid, public.workplaces, timestamptz, text) from public, anon, authenticated;
