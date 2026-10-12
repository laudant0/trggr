-- Admin role, moderation queue, official polls and timed polls.
--
-- After running this, make yourself an admin (replace the email with your Google account's email):
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'you@example.com';

create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins a where a.user_id = (select auth.uid()));
$$;

alter table public.polls
  add column closes_at timestamptz,
  add column official boolean not null default false;
create index polls_closing_idx on public.polls (closes_at) where closes_at is not null;

-- The public feed now carries the closing time and the official flag.
drop function public.get_public_polls();
create function public.get_public_polls()
returns table (
  id uuid,
  question text,
  category text,
  tag text,
  creator text,
  created_at timestamptz,
  options jsonb,
  total_votes bigint,
  my_option_position smallint,
  closes_at timestamptz,
  official boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.question,
    p.category,
    p.tag,
    case
      when p.official then 'TRGGA desk'
      else coalesce(case when pr.discoverable then pr.display_name end, 'TRGGA community')
    end as creator,
    p.created_at,
    option_data.options,
    option_data.total_votes,
    own_vote.position as my_option_position,
    p.closes_at,
    p.official
  from public.polls p
  left join public.profiles pr on pr.id = p.created_by
  cross join lateral (
    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', po.id,
            'label', po.label,
            'position', po.position,
            'image_path', po.image_path,
            'votes', coalesce(counts.vote_count, 0)
          ) order by po.position
        ),
        '[]'::jsonb
      ) as options,
      coalesce(sum(counts.vote_count), 0)::bigint as total_votes
    from public.poll_options po
    left join lateral (
      select count(*)::bigint as vote_count
      from public.poll_votes v
      where v.option_id = po.id
    ) counts on true
    where po.poll_id = p.id
  ) option_data
  left join lateral (
    select po.position
    from public.poll_votes v
    join public.poll_options po on po.id = v.option_id and po.poll_id = v.poll_id
    where v.poll_id = p.id and v.user_id = (select auth.uid())
    limit 1
  ) own_vote on true
  where p.status = 'published'
  order by p.created_at desc, p.id;
$$;
revoke all on function public.get_public_polls() from public;
grant execute on function public.get_public_polls() to anon, authenticated;

-- Voting stops when a poll closes.
create or replace function public.vote_on_poll(p_poll_id uuid, p_option_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  vote_user_id uuid := (select auth.uid());
  inserted_count integer;
  current_total bigint;
begin
  if vote_user_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.polls p
    join public.poll_options po on po.poll_id = p.id
    where p.id = p_poll_id and po.id = p_option_id and p.status = 'published'
  ) then
    raise exception 'poll_or_option_not_found' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.polls p where p.id = p_poll_id and p.closes_at is not null and p.closes_at <= now()
  ) then
    raise exception 'This poll has closed.' using errcode = 'P0001';
  end if;

  insert into public.poll_votes (poll_id, option_id, user_id)
  values (p_poll_id, p_option_id, vote_user_id)
  on conflict (poll_id, user_id) do nothing;

  get diagnostics inserted_count = row_count;

  select count(*) into current_total from public.poll_votes v where v.poll_id = p_poll_id;

  return jsonb_build_object('recorded', inserted_count = 1, 'total_votes', current_total);
end;
$$;

-- Members can set a closing time between 10 minutes and 30 days from now.
drop function public.create_poll_with_options(text, text, text[], text[]);
create function public.create_poll_with_options(
  p_question text,
  p_category text,
  p_options text[],
  p_option_images text[] default null,
  p_closes_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  new_poll_id uuid;
  option_count integer;
begin
  if current_user_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if p_question is null or char_length(btrim(p_question)) not between 5 and 110 then
    raise exception 'invalid_question' using errcode = '22023';
  end if;
  if not exists (select 1 from public.poll_categories c where c.name = p_category) then
    raise exception 'invalid_category' using errcode = '22023';
  end if;
  if p_closes_at is not null and (p_closes_at < now() + interval '10 minutes' or p_closes_at > now() + interval '30 days 1 hour') then
    raise exception 'invalid_closing_time' using errcode = '22023';
  end if;

  option_count := coalesce(cardinality(p_options), 0);
  if option_count not between 2 and 4
    or exists (
      select 1 from unnest(p_options) option_label
      where option_label is null or char_length(btrim(option_label)) not between 1 and 40
    )
    or (
      select count(distinct lower(btrim(option_label))) from unnest(p_options) option_label
    ) <> option_count then
    raise exception 'invalid_options' using errcode = '22023';
  end if;

  if p_option_images is not null and cardinality(p_option_images) <> option_count then
    raise exception 'invalid_option_images' using errcode = '22023';
  end if;

  if p_option_images is not null and exists (
    select 1
    from unnest(p_option_images) as option_images(image_path)
    where option_images.image_path is not null
      and (
        split_part(option_images.image_path, '/', 1) <> current_user_id::text
        or split_part(option_images.image_path, '/', 2) !~ '^[0-9a-f-]{36}\.webp$'
        or not exists (
          select 1
          from storage.objects image
          where image.bucket_id = 'poll-option-images'
            and image.name = option_images.image_path
            and image.metadata ->> 'mimetype' = 'image/webp'
            and nullif(image.metadata ->> 'size', '')::bigint <= 524288
        )
      )
  ) then
    raise exception 'invalid_option_image' using errcode = '22023';
  end if;

  insert into public.polls (created_by, question, category, closes_at)
  values (current_user_id, btrim(p_question), p_category, p_closes_at)
  returning id into new_poll_id;

  insert into public.poll_options (poll_id, label, position, image_path)
  select
    new_poll_id,
    btrim(options.option_label),
    (options.option_index - 1)::smallint,
    case when p_option_images is null then null else p_option_images[options.option_index::integer] end
  from unnest(p_options) with ordinality as options(option_label, option_index);

  return new_poll_id;
end;
$$;
revoke all on function public.create_poll_with_options(text, text, text[], text[], timestamptz) from public;
grant execute on function public.create_poll_with_options(text, text, text[], text[], timestamptz) to authenticated;

-- Admin only: publish an official poll (poll of the day, goat debate, etc.).
create function public.admin_create_poll(
  p_question text,
  p_category text,
  p_options text[],
  p_tag text default 'OFFICIAL POLL',
  p_closes_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_poll_id uuid;
  option_count integer := coalesce(cardinality(p_options), 0);
begin
  if not public.is_admin() then
    raise exception 'admin_only' using errcode = '42501';
  end if;
  if p_question is null or char_length(btrim(p_question)) not between 5 and 110 then
    raise exception 'invalid_question' using errcode = '22023';
  end if;
  if not exists (select 1 from public.poll_categories c where c.name = p_category) then
    raise exception 'invalid_category' using errcode = '22023';
  end if;
  if p_tag is null or char_length(btrim(p_tag)) not between 1 and 30 then
    raise exception 'invalid_tag' using errcode = '22023';
  end if;
  if option_count not between 2 and 4
    or exists (select 1 from unnest(p_options) l where l is null or char_length(btrim(l)) not between 1 and 40)
    or (select count(distinct lower(btrim(l))) from unnest(p_options) l) <> option_count then
    raise exception 'invalid_options' using errcode = '22023';
  end if;
  if p_closes_at is not null and p_closes_at < now() + interval '10 minutes' then
    raise exception 'invalid_closing_time' using errcode = '22023';
  end if;

  insert into public.polls (created_by, question, category, tag, official, closes_at)
  values (null, btrim(p_question), p_category, upper(btrim(p_tag)), true, p_closes_at)
  returning id into new_poll_id;

  insert into public.poll_options (poll_id, label, position)
  select new_poll_id, btrim(o.label), (o.idx - 1)::smallint
  from unnest(p_options) with ordinality as o(label, idx);

  return new_poll_id;
end;
$$;

-- Admin only: every poll that has reports or is hidden, worst first.
create function public.admin_get_queue()
returns table (
  poll_id uuid,
  question text,
  category text,
  status text,
  creator text,
  created_at timestamptz,
  report_count bigint,
  reasons jsonb,
  details jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin_only' using errcode = '42501';
  end if;
  return query
  select
    p.id,
    p.question,
    p.category,
    p.status,
    case when p.official then 'TRGGA desk' else coalesce(pr.display_name, 'Unknown member') end,
    p.created_at,
    count(r.id),
    coalesce(jsonb_agg(distinct r.reason) filter (where r.reason is not null), '[]'::jsonb),
    coalesce(jsonb_agg(r.details) filter (where r.details is not null), '[]'::jsonb)
  from public.polls p
  left join public.profiles pr on pr.id = p.created_by
  left join public.poll_reports r on r.poll_id = p.id
  group by p.id, pr.display_name
  having count(r.id) > 0 or p.status = 'hidden'
  order by count(r.id) desc, p.created_at desc
  limit 100;
end;
$$;

create function public.admin_set_poll_status(p_poll_id uuid, p_status text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed int;
begin
  if not public.is_admin() then
    raise exception 'admin_only' using errcode = '42501';
  end if;
  if p_status not in ('published', 'hidden') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  update public.polls set status = p_status where id = p_poll_id;
  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;

create function public.admin_dismiss_reports(p_poll_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed int;
begin
  if not public.is_admin() then
    raise exception 'admin_only' using errcode = '42501';
  end if;
  delete from public.poll_reports where poll_id = p_poll_id;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

create function public.admin_delete_poll(p_poll_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed int;
begin
  if not public.is_admin() then
    raise exception 'admin_only' using errcode = '42501';
  end if;
  delete from public.polls where id = p_poll_id;
  get diagnostics removed = row_count;
  return removed > 0;
end;
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.admin_create_poll(text, text, text[], text, timestamptz) from public;
revoke all on function public.admin_get_queue() from public;
revoke all on function public.admin_set_poll_status(uuid, text) from public;
revoke all on function public.admin_dismiss_reports(uuid) from public;
revoke all on function public.admin_delete_poll(uuid) from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_create_poll(text, text, text[], text, timestamptz) to authenticated;
grant execute on function public.admin_get_queue() to authenticated;
grant execute on function public.admin_set_poll_status(uuid, text) to authenticated;
grant execute on function public.admin_dismiss_reports(uuid) to authenticated;
grant execute on function public.admin_delete_poll(uuid) to authenticated;

-- Members can delete their own account. Their polls stay up, anonymised; votes, pins, notes and follows go.
create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'sign_in_required' using errcode = '28000';
  end if;
  delete from auth.users where id = uid;
end;
$$;
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;