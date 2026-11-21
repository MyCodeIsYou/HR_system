-- 휴가 전날 18:00(한국 시간) 이후, 승인된 휴가가 있는 계정의 기기로 알림을 보낸다.
-- 5분마다 확인하고, 그 날짜에 아직 보내지 못한 계정만 보낸다.

create table if not exists public.leave_eve_sends (
  user_id uuid not null references public.profiles (id) on delete cascade,
  work_date date not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, work_date)
);

alter table public.leave_eve_sends enable row level security;
revoke all on table public.leave_eve_sends from public, anon, authenticated;

do $$
declare
  v_job bigint;
begin
  select jobid into v_job from cron.job where jobname = 'leave-eve-push';
  if v_job is not null then
    perform cron.unschedule(v_job);
  end if;
end $$;

select cron.schedule(
  'leave-eve-push',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/leave-eve-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'weekly_leave_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
