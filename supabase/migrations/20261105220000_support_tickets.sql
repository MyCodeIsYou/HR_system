-- 직원이 수정 요청과 문의를 남기는 고객센터.
-- 목록은 페이지로 나누고, 이름은 이 함수 안에서만 마스킹해서 돌려준다.

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('correction', 'inquiry')),
  title text not null,
  body text not null,
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  reply text not null default '',
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_tickets_title_check check (char_length(btrim(title)) between 1 and 80),
  constraint support_tickets_body_check check (char_length(btrim(body)) between 1 and 2000),
  constraint support_tickets_reply_check check (char_length(reply) <= 2000)
);

create index support_tickets_org_created_idx
  on public.support_tickets (organization_id, created_at desc);

alter table public.support_tickets enable row level security;
revoke all on table public.support_tickets from public, anon, authenticated;

create or replace function public.mask_person_name(p_name text)
returns text
language sql
immutable
as $$
  select case
    when p_name is null or char_length(btrim(p_name)) = 0 then ''
    when char_length(btrim(p_name)) = 1 then '*'
    when char_length(btrim(p_name)) = 2 then left(btrim(p_name), 1) || '*'
    else left(btrim(p_name), 1) || repeat('*', char_length(btrim(p_name)) - 2) || right(btrim(p_name), 1)
  end
$$;

create or replace function public.support_ticket_page(p_page integer, p_size integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_page integer;
  v_size integer;
  v_total bigint;
  v_items jsonb;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select organization_id into v_org
  from public.profiles
  where id = auth.uid();

  if v_org is null then
    raise exception '조직이 없습니다.';
  end if;

  v_page := greatest(coalesce(p_page, 1), 1);
  v_size := least(greatest(coalesce(p_size, 10), 1), 20);

  select count(*) into v_total
  from public.support_tickets
  where organization_id = v_org;

  select coalesce(jsonb_agg(to_jsonb(ticket) order by ticket.created_at desc), '[]'::jsonb)
    into v_items
  from (
    select
      t.id,
      t.kind,
      t.title,
      t.body,
      t.status,
      t.reply,
      public.mask_person_name(p.name) as masked_name,
      (t.user_id = auth.uid()) as mine,
      t.created_at,
      t.updated_at,
      t.replied_at
    from public.support_tickets t
    join public.profiles p on p.id = t.user_id
    where t.organization_id = v_org
    order by t.created_at desc
    offset (v_page - 1) * v_size
    limit v_size
  ) as ticket;

  return jsonb_build_object(
    'total', v_total,
    'page', v_page,
    'size', v_size,
    'items', v_items
  );
end $$;

create or replace function public.create_support_ticket(p_kind text, p_title text, p_body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_id uuid;
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(coalesce(p_body, ''));
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if p_kind not in ('correction', 'inquiry') then
    raise exception '종류를 선택해 주세요.';
  end if;
  if char_length(v_title) < 1 or char_length(v_title) > 80 then
    raise exception '제목은 1자 이상 80자 이하로 입력해 주세요.';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception '내용은 1자 이상 2000자 이하로 입력해 주세요.';
  end if;

  select organization_id into v_org
  from public.profiles
  where id = auth.uid();
  if v_org is null then
    raise exception '조직이 없습니다.';
  end if;

  insert into public.support_tickets (organization_id, user_id, kind, title, body)
  values (v_org, auth.uid(), p_kind, v_title, v_body)
  returning id into v_id;

  return v_id;
end $$;

create or replace function public.update_support_ticket(p_id uuid, p_kind text, p_title text, p_body text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(coalesce(p_body, ''));
  v_count integer;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if p_kind not in ('correction', 'inquiry') then
    raise exception '종류를 선택해 주세요.';
  end if;
  if char_length(v_title) < 1 or char_length(v_title) > 80 then
    raise exception '제목은 1자 이상 80자 이하로 입력해 주세요.';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception '내용은 1자 이상 2000자 이하로 입력해 주세요.';
  end if;

  update public.support_tickets
  set kind = p_kind,
      title = v_title,
      body = v_body,
      updated_at = now()
  where id = p_id
    and user_id = auth.uid()
    and organization_id = public.current_org_id()
    and status = 'open';

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception '접수 중인 내 글만 수정할 수 있습니다.';
  end if;
end $$;

create or replace function public.delete_support_ticket(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  delete from public.support_tickets
  where id = p_id
    and user_id = auth.uid()
    and organization_id = public.current_org_id()
    and status = 'open';

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception '접수 중인 내 글만 삭제할 수 있습니다.';
  end if;
end $$;

create or replace function public.reply_support_ticket(p_id uuid, p_reply text, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reply text := btrim(coalesce(p_reply, ''));
  v_count integer;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;
  if not public.is_admin() then
    raise exception '관리자만 답변할 수 있습니다.';
  end if;
  if p_status not in ('answered', 'closed') then
    raise exception '상태를 확인해 주세요.';
  end if;
  if p_status = 'answered' and (char_length(v_reply) < 1 or char_length(v_reply) > 2000) then
    raise exception '답변은 1자 이상 2000자 이하로 입력해 주세요.';
  end if;
  if char_length(v_reply) > 2000 then
    raise exception '답변은 2000자 이하로 입력해 주세요.';
  end if;

  update public.support_tickets
  set reply = v_reply,
      status = p_status,
      replied_at = case when char_length(v_reply) > 0 then now() else replied_at end,
      updated_at = now()
  where id = p_id
    and organization_id = public.current_org_id();

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception '글을 찾을 수 없습니다.';
  end if;
end $$;

revoke all on function public.mask_person_name(text) from public, anon, authenticated;
revoke all on function public.support_ticket_page(integer, integer) from public, anon;
revoke all on function public.create_support_ticket(text, text, text) from public, anon;
revoke all on function public.update_support_ticket(uuid, text, text, text) from public, anon;
revoke all on function public.delete_support_ticket(uuid) from public, anon;
revoke all on function public.reply_support_ticket(uuid, text, text) from public, anon;

grant execute on function public.support_ticket_page(integer, integer) to authenticated;
grant execute on function public.create_support_ticket(text, text, text) to authenticated;
grant execute on function public.update_support_ticket(uuid, text, text, text) to authenticated;
grant execute on function public.delete_support_ticket(uuid) to authenticated;
grant execute on function public.reply_support_ticket(uuid, text, text) to authenticated;
