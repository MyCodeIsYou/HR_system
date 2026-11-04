-- 매주 월요일 09:00(한국 시간)에 이번 주 휴가 일정을 보낸다.
-- 받는 주소는 휴가 페이지에 저장한 leave_digest_emails 뿐이다.
-- pg_cron 시간대는 GMT이므로 월요일 00:00 UTC다.
-- 호출 비밀키는 vault 이름 weekly_leave_secret 에 둔다.

create extension if not exists pg_cron;
create extension if not exists pg_net;

alter table public.organizations
  add column if not exists leave_digest_emails text[] not null default '{}';

create or replace function public.leave_digest_emails_ok(emails text[])
returns boolean
language plpgsql
immutable
as $$
declare
  email text;
  seen text[] := '{}';
begin
  if emails is null or cardinality(emails) > 20 then
    return false;
  end if;
  foreach email in array emails loop
    if email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or email <> lower(email) or email = any (seen) then
      return false;
    end if;
    seen := seen || email;
  end loop;
  return true;
end $$;

alter table public.organizations drop constraint if exists organizations_leave_digest_emails_check;
alter table public.organizations
  add constraint organizations_leave_digest_emails_check
  check (public.leave_digest_emails_ok(leave_digest_emails));

create table if not exists public.leave_digest_sends (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  week_start date not null,
  sent_at timestamptz not null default now(),
  recipient_count integer not null,
  primary key (organization_id, week_start)
);

alter table public.leave_digest_sends enable row level security;
revoke all on table public.leave_digest_sends from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'project_url') then
    perform vault.create_secret(
      'https://vqdnkgiayqltiptzyryd.supabase.co',
      'project_url',
      '주간 휴가 메일 함수 주소',
      null
    );
  end if;
end $$;

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
  '0 0 * * 1',
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
