-- 주간 휴가 메일의 요일과 시각은 조직 설정이다. 시각은 한국 시간.
-- 배치는 5분마다 깨어나, 정한 요일이고 시각이 지났으며 이번 주에 아직 안 보낸 경우에만 보낸다.

alter table public.organizations
  add column if not exists leave_digest_weekday smallint not null default 1,
  add column if not exists leave_digest_time time not null default '09:00';

alter table public.organizations drop constraint if exists organizations_leave_digest_weekday_check;
alter table public.organizations
  add constraint organizations_leave_digest_weekday_check
  check (leave_digest_weekday between 0 and 6);

do $$
declare
  v_job bigint;
begin
  select jobid into v_job from cron.job where jobname = 'weekly-leave-digest';
  if v_job is not null then
    perform cron.unschedule(v_job);
  end if;
end $$;

select cron.schedule(
  'weekly-leave-digest',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/weekly-leave-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'weekly_leave_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
