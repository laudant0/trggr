-- Block members, one-line "takes" on polls (top 3 by agrees), creator poll results, admin take moderation.

-- ---------------------------------------------------------------- blocking
create table public.member_blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index member_blocks_blocked_idx on public.member_blocks (blocked_id);
alter table public.member_blocks enable row level security;
revoke all on public.member_blocks from anon, authenticated;

create function public.is_blocked_pair(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select a is not null and b is not null and exists (
    select 1 from public.member_blocks m
    where (m.blocker_id = a and m.blocked_id = b) or (m.blocker_id = b and m.blocked_id = a)
  );
$$;
revoke all on function public.is_blocked_pair(uuid, uuid) from public;

create function public.toggle_block(p_member_id uuid)
returns boolean
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
  if uid = p_member_id then
    raise exception 'cannot_block_self' using errcode = '22023';
  end if;
  if exists (select 1 from public.member_blocks where blocker_id = uid and blocked_id = p_member_id) then
    delete from public.member_blocks where blocker_id = uid and blocked_id = p_member_id;
    return false;
  end if;
  if not exists (select 1 from public.profiles where id = p_member_id) then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
  insert into public.member_blocks (blocker_id, blocked_id) values (uid, p_member_id);
  delete from public.member_follows
    where (follower_id = uid and followee_id = p_member_id) or (follower_id = p_member_id and followee_id = uid);
  delete from public.notifications
    where (user_id = uid and actor_id = p_member_id) or (user_id = p_member_id and actor_id = uid);
  return true;
end;
$$;

create function public.get_my_blocks()
returns table (id uuid, display_name text, avatar_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.blocked_id, coalesce(pr.display_name, 'TRGGA member'), pr.avatar_path
  from public.member_blocks m
  left join public.profiles pr on pr.id = m.blocked_id
  where m.blocker_id = (select auth.uid())
  order by m.created_at desc;
$$;

-- Following is not possible across a block.
create or replace function public.toggle_follow(p_member_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  recent integer;
begin
  if uid is null then
    raise exception 'sign_in_required' using errcode = '28000';
  end if;
  if uid = p_member_id then
    raise exception 'cannot_follow_self' using errcode = '22023';
  end if;
  if exists (select 1 from public.member_follows where follower_id = uid and followee_id = p_member_id) then
    delete from public.member_follows where follower_id = uid and followee_id = p_member_id;
    return false;
  end if;
  if public.is_blocked_pair(uid, p_member_id) then
    raise exception 'profile_not_found_or_private' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.profiles where id = p_member_id and discoverable) then
    raise exception 'profile_not_found_or_private' using errcode = 'P0002';
  end if;
  select count(*) into recent from public.member_follows
    where follower_id = uid and created_at > now() - interval '1 hour';
  if recent >= 60 then
    raise exception 'You are connecting too quickly. Try again later.' using errcode = 'P0001';
  end if;
  insert into public.member_follows (follower_id, followee_id) values (uid, p_member_id);
  return true;
end;
$$;

-- A member who blocked you looks private to you.
create or replace function public.get_public_profile(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_profile public.profiles%rowtype;
begin
  select * into target_profile
  from public.profiles pr
  where pr.id = p_profile_id and pr.discoverable
    and not exists (
      select 1 from public.member_blocks b
      where b.blocker_id = p_profile_id and b.blocked_id = (select auth.uid())
    );

  if not found then
    raise exception 'profile_not_found_or_private' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'id', target_profile.id,
    'display_name', target_profile.display_name,
    'avatar_url', target_profile.avatar_url,
    'bio', target_profile.bio,
    'created_at', target_profile.created_at,
    'stats', jsonb_build_object(
      'polls_created', (
        select count(*) from public.polls p
        where p.created_by = target_profile.id and p.status = 'published'
      ),
      'votes_received', (
        select count(*)
        from public.poll_votes v
        join public.polls p on p.id = v.poll_id
        where p.created_by = target_profile.id and p.status = 'published'
      )
    ),
    'recent_polls', coalesce((
      select jsonb_agg(to_jsonb(recent_poll) order by recent_poll.created_at desc)
      from (
        select
          p.question,
          p.category,
          p.created_at,
          count(v.id)::bigint as total_votes
        from public.polls p
        left join public.poll_options po on po.poll_id = p.id
        left join public.poll_votes v on v.option_id = po.id
        where p.created_by = target_profile.id and p.status = 'published'
        group by p.id
        order by p.created_at desc
        limit 8
      ) recent_poll
    ), '[]'::jsonb)
  );
end;
$$;

-- Member directory skips blocked pairs.
create or replace function public.get_discoverable_profiles(p_search text default null)
returns table (
  id uuid,
  display_name text,
  bio text,
  avatar_url text,
  created_at timestamptz,
  polls_created bigint,
  votes_received bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    pr.id,
    pr.display_name,
    pr.bio,
    pr.avatar_url,
    pr.created_at,
    count(distinct p.id)::bigint as polls_created,
    count(v.id)::bigint as votes_received
  from public.profiles pr
  left join public.polls p on p.created_by = pr.id and p.status = 'published'
  left join public.poll_options po on po.poll_id = p.id
  left join public.poll_votes v on v.option_id = po.id
  where pr.discoverable
    and not public.is_blocked_pair((select auth.uid()), pr.id)
    and (
      nullif(btrim(p_search), '') is null
      or (
        char_length(btrim(p_search)) <= 60
        and (
          pr.display_name ilike '%' || btrim(p_search) || '%'
          or pr.bio ilike '%' || btrim(p_search) || '%'
        )
      )
    )
  group by pr.id
  order by count(distinct p.id) desc, pr.created_at desc
  limit 48;
$$;

-- The feed hides polls from members you blocked or who blocked you.
create or replace function public.get_public_polls()
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
    and not public.is_blocked_pair((select auth.uid()), p.created_by)
  order by p.created_at desc, p.id;
$$;

-- ------------------------------------------------------------------- takes
-- A take is one short line, written after voting. No replies and no threads.
-- The top three per poll are shown: most agrees first, then newest.
create table public.poll_takes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 100),
  status text not null default 'published' check (status in ('published', 'hidden')),
  created_at timestamptz not null default now(),
  unique (poll_id, author_id)
);
create index poll_takes_poll_idx on public.poll_takes (poll_id, status);
create table public.take_agrees (
  take_id uuid not null references public.poll_takes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (take_id, user_id)
);
create table public.take_reports (
  take_id uuid not null references public.poll_takes (id) on delete cascade,
  reporter_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (take_id, reporter_id)
);
alter table public.poll_takes enable row level security;
alter table public.take_agrees enable row level security;
alter table public.take_reports enable row level security;
revoke all on public.poll_takes, public.take_agrees, public.take_reports from anon, authenticated;

create function public.post_take(p_poll_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  new_id uuid;
  recent integer;
begin
  if uid is null then
    raise exception 'sign_in_required' using errcode = '28000';
  end if;
  if p_body is null or char_length(btrim(p_body)) not between 1 and 100 then
    raise exception 'Keep your take between 1 and 100 characters.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.polls p where p.id = p_poll_id and p.status = 'published') then
    raise exception 'poll_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.poll_votes v where v.poll_id = p_poll_id and v.user_id = uid) then
    raise exception 'Vote first, then add your take.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.poll_takes t where t.poll_id = p_poll_id and t.author_id = uid) then
    raise exception 'You already added a take. Delete it to write a new one.' using errcode = 'P0001';
  end if;
  select count(*) into recent from public.poll_takes t
    where t.author_id = uid and t.created_at > now() - interval '1 hour';
  if recent >= 30 then
    raise exception 'You are posting too quickly. Try again later.' using errcode = 'P0001';
  end if;
  insert into public.poll_takes (poll_id, author_id, body)
  values (p_poll_id, uid, btrim(p_body))
  returning id into new_id;
  return new_id;
end;
$$;

create function public.delete_my_take(p_poll_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.poll_takes t
  where t.poll_id = p_poll_id and t.author_id = (select auth.uid()) and t.status = 'published';
$$;

create function public.toggle_take_agree(p_take_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  take_row public.poll_takes%rowtype;
begin
  if uid is null then
    raise exception 'sign_in_required' using errcode = '28000';
  end if;
  select * into take_row from public.poll_takes t where t.id = p_take_id and t.status = 'published';
  if not found then
    raise exception 'take_not_found' using errcode = 'P0002';
  end if;
  if take_row.author_id = uid then
    raise exception 'You cannot agree with your own take.' using errcode = 'P0001';
  end if;
  if public.is_blocked_pair(uid, take_row.author_id) then
    raise exception 'take_not_found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.poll_votes v where v.poll_id = take_row.poll_id and v.user_id = uid) then
    raise exception 'Vote first, then agree with takes.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.take_agrees a where a.take_id = p_take_id and a.user_id = uid) then
    delete from public.take_agrees a where a.take_id = p_take_id and a.user_id = uid;
    return false;
  end if;
  insert into public.take_agrees (take_id, user_id) values (p_take_id, uid);
  return true;
end;
$$;

create function public.report_take(p_take_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  inserted integer;
begin
  if uid is null then
    raise exception 'sign_in_required' using errcode = '28000';
  end if;
  if not exists (select 1 from public.poll_takes t where t.id = p_take_id and t.author_id <> uid) then
    raise exception 'take_not_found' using errcode = 'P0002';
  end if;
  insert into public.take_reports (take_id, reporter_id) values (p_take_id, uid)
  on conflict do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then
    return false;
  end if;
  if (select count(*) from public.take_reports r where r.take_id = p_take_id) >= 3 then
    update public.poll_takes set status = 'hidden' where id = p_take_id;
  end if;
  return true;
end;
$$;

-- Takes become visible once you have voted, or once the poll has closed.
create function public.get_takes(p_poll_ids uuid[])
returns table (
  poll_id uuid,
  take_id uuid,
  body text,
  author_id uuid,
  author_name text,
  agrees integer,
  i_agreed boolean,
  mine boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select x.poll_id, x.take_id, x.body, x.author_id, x.author_name, x.agrees, x.i_agreed, x.mine, x.created_at
  from (
    select
      t.poll_id,
      t.id as take_id,
      t.body,
      case when pr.discoverable or t.author_id = (select auth.uid()) then t.author_id end as author_id,
      case when pr.discoverable or t.author_id = (select auth.uid()) then pr.display_name else 'A TRGGA member' end as author_name,
      ag.cnt as agrees,
      ag.mine_agree as i_agreed,
      t.author_id = (select auth.uid()) as mine,
      t.created_at,
      row_number() over (partition by t.poll_id order by ag.cnt desc, t.created_at desc) as rn
    from public.poll_takes t
    join public.polls p on p.id = t.poll_id and p.status = 'published'
    left join public.profiles pr on pr.id = t.author_id
    cross join lateral (
      select count(*)::integer as cnt, coalesce(bool_or(a.user_id = (select auth.uid())), false) as mine_agree
      from public.take_agrees a
      where a.take_id = t.id
    ) ag
    where t.poll_id = any (p_poll_ids)
      and cardinality(p_poll_ids) <= 60
      and t.status = 'published'
      and (
        (p.closes_at is not null and p.closes_at <= now())
        or exists (select 1 from public.poll_votes v where v.poll_id = t.poll_id and v.user_id = (select auth.uid()))
      )
      and not public.is_blocked_pair((select auth.uid()), t.author_id)
  ) x
  where x.rn <= 3 or x.mine
  order by x.poll_id, x.agrees desc, x.created_at desc;
$$;

-- ---------------------------------------------------- creator poll results
create function public.get_my_poll_results()
returns table (
  poll_id uuid,
  question text,
  status text,
  created_at timestamptz,
  closes_at timestamptz,
  total_votes bigint,
  options jsonb,
  daily jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.question,
    p.status,
    p.created_at,
    p.closes_at,
    (select count(*) from public.poll_votes v where v.poll_id = p.id),
    (
      select coalesce(jsonb_agg(jsonb_build_object(
        'label', po.label,
        'votes', (select count(*) from public.poll_votes v where v.option_id = po.id)
      ) order by po.position), '[]'::jsonb)
      from public.poll_options po where po.poll_id = p.id
    ),
    (
      select jsonb_agg(jsonb_build_object('day', d.day, 'votes', coalesce(c.votes, 0)) order by d.day)
      from (select (current_date - n)::date as day from generate_series(0, 13) as n) d
      left join (
        select v.created_at::date as day, count(*) as votes
        from public.poll_votes v
        where v.poll_id = p.id
        group by 1
      ) c on c.day = d.day
    )
  from public.polls p
  where p.created_by = (select auth.uid())
  order by p.created_at desc
  limit 50;
$$;

-- --------------------------------------------------------- admin: takes
create function public.admin_get_reported_takes()
returns table (
  take_id uuid,
  body text,
  poll_question text,
  author_name text,
  status text,
  report_count bigint,
  created_at timestamptz
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
  select t.id, t.body, p.question, coalesce(pr.display_name, 'Unknown member'), t.status,
    (select count(*) from public.take_reports r where r.take_id = t.id), t.created_at
  from public.poll_takes t
  join public.polls p on p.id = t.poll_id
  left join public.profiles pr on pr.id = t.author_id
  where t.status = 'hidden' or exists (select 1 from public.take_reports r where r.take_id = t.id)
  order by 6 desc, t.created_at desc
  limit 100;
end;
$$;

create function public.admin_delete_take(p_take_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin_only' using errcode = '42501';
  end if;
  delete from public.poll_takes where id = p_take_id;
end;
$$;

create function public.admin_restore_take(p_take_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin_only' using errcode = '42501';
  end if;
  delete from public.take_reports where take_id = p_take_id;
  update public.poll_takes set status = 'published' where id = p_take_id;
end;
$$;

-- ------------------------------------------------------------------ grants
revoke all on function public.toggle_block(uuid) from public;
revoke all on function public.get_my_blocks() from public;
revoke all on function public.post_take(uuid, text) from public;
revoke all on function public.delete_my_take(uuid) from public;
revoke all on function public.toggle_take_agree(uuid) from public;
revoke all on function public.report_take(uuid) from public;
revoke all on function public.get_takes(uuid[]) from public;
revoke all on function public.get_my_poll_results() from public;
revoke all on function public.admin_get_reported_takes() from public;
revoke all on function public.admin_delete_take(uuid) from public;
revoke all on function public.admin_restore_take(uuid) from public;
grant execute on function public.toggle_block(uuid) to authenticated;
grant execute on function public.get_my_blocks() to authenticated;
grant execute on function public.post_take(uuid, text) to authenticated;
grant execute on function public.delete_my_take(uuid) to authenticated;
grant execute on function public.toggle_take_agree(uuid) to authenticated;
grant execute on function public.report_take(uuid) to authenticated;
grant execute on function public.get_takes(uuid[]) to anon, authenticated;
grant execute on function public.get_my_poll_results() to authenticated;
grant execute on function public.admin_get_reported_takes() to authenticated;
grant execute on function public.admin_delete_take(uuid) to authenticated;
grant execute on function public.admin_restore_take(uuid) to authenticated;
