-- 휴가 전날 알림은 매일 17:00(한국 시간)에 한 번만 실행한다.
-- pg_cron 시간대는 UTC이므로 08:00 UTC다.

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
  '0 8 * * *',
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
