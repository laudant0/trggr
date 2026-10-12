-- Follower and following counts are private: only the member can see their own.
create or replace function public.get_connection_state(p_member_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if not exists (
    select 1 from public.profiles where id = p_member_id and (discoverable or id = uid)
  ) then
    raise exception 'profile_not_found_or_private' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'followers', case when uid = p_member_id
      then (select count(*) from public.member_follows where followee_id = p_member_id) end,
    'following', case when uid = p_member_id then (
      select count(*) from public.member_follows f
      join public.profiles pr on pr.id = f.followee_id
      where f.follower_id = p_member_id and pr.discoverable
    ) end,
    'i_follow', uid is not null and exists (
      select 1 from public.member_follows where follower_id = uid and followee_id = p_member_id
    ),
    'follows_me', uid is not null and exists (
      select 1 from public.member_follows where follower_id = p_member_id and followee_id = uid
    )
  );
end;
$$;

-- Pins: private bookmarks of polls.
create table public.poll_pins (
  user_id uuid not null references auth.users (id) on delete cascade,
  poll_id uuid not null references public.polls (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, poll_id)
);
create index poll_pins_user_recent_idx on public.poll_pins (user_id, created_at desc);
alter table public.poll_pins enable row level security;
revoke all on public.poll_pins from anon, authenticated;

create function public.toggle_pin(p_poll_id uuid)
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
  if exists (select 1 from public.poll_pins where user_id = uid and poll_id = p_poll_id) then
    delete from public.poll_pins where user_id = uid and poll_id = p_poll_id;
    return false;
  end if;
  if not exists (select 1 from public.polls where id = p_poll_id and status = 'published') then
    raise exception 'poll_not_found' using errcode = 'P0002';
  end if;
  if (select count(*) from public.poll_pins where user_id = uid) >= 200 then
    raise exception 'You can pin up to 200 polls. Unpin one first.' using errcode = 'P0001';
  end if;
  insert into public.poll_pins (user_id, poll_id) values (uid, p_poll_id);
  return true;
end;
$$;

create function public.get_my_pins()
returns table (poll_id uuid, question text, category text, pinned_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.question, p.category, pin.created_at
  from public.poll_pins pin
  join public.polls p on p.id = pin.poll_id
  where pin.user_id = (select auth.uid()) and p.status = 'published'
  order by pin.created_at desc
  limit 200;
$$;

-- iWindow: a private look at how your votes compare with the room.
create function public.get_my_window()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select v.poll_id, v.option_id, v.created_at, p.question, p.category
    from public.poll_votes v
    join public.polls p on p.id = v.poll_id
    where v.user_id = (select auth.uid()) and p.status = 'published'
    order by v.created_at desc
    limit 500
  ),
  t as (
    select m.poll_id, m.question, m.category, m.created_at, po.label,
      (select count(*) from public.poll_votes x where x.option_id = m.option_id) as my_votes,
      (select count(*) from public.poll_votes x where x.poll_id = m.poll_id) as total_votes,
      (select max(c) from (
        select count(*) as c from public.poll_votes x where x.poll_id = m.poll_id group by x.option_id
      ) s) as top_votes
    from mine m
    join public.poll_options po on po.id = m.option_id
  ),
  cats as (
    select category, count(*) as c from t group by category order by c desc, category limit 3
  )
  select jsonb_build_object(
    'total', (select count(*) from t),
    'with_room', (select count(*) from t where my_votes >= top_votes),
    'top_categories', coalesce((
      select jsonb_agg(jsonb_build_object('category', category, 'count', c)) from cats
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'poll_id', r.poll_id,
        'question', r.question,
        'category', r.category,
        'my_label', r.label,
        'my_percent', round(100.0 * r.my_votes / nullif(r.total_votes, 0)),
        'total_votes', r.total_votes,
        'with_room', r.my_votes >= r.top_votes
      ) order by r.created_at desc)
      from (select * from t order by created_at desc limit 12) r
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.toggle_pin(uuid) from public;
revoke all on function public.get_my_pins() from public;
revoke all on function public.get_my_window() from public;
grant execute on function public.toggle_pin(uuid) to authenticated;
grant execute on function public.get_my_pins() to authenticated;
grant execute on function public.get_my_window() to authenticated;
