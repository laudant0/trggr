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

-- Window: a private look at how your votes compare with the room.
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

-- Window notes: short notes visible only to their author and the author's followers.
create table public.window_notes (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index window_notes_author_recent_idx on public.window_notes (author_id, created_at desc);
alter table public.window_notes enable row level security;
revoke all on public.window_notes from anon, authenticated;

create function public.post_window_note(p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  new_id uuid;
begin
  if uid is null then
    raise exception 'sign_in_required' using errcode = '28000';
  end if;
  if (select count(*) from public.window_notes where author_id = uid and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'You are posting too fast. Try again later.' using errcode = 'P0001';
  end if;
  insert into public.window_notes (author_id, body) values (uid, btrim(p_body)) returning id into new_id;
  return new_id;
end;
$$;

create function public.delete_window_note(p_note_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed int;
begin
  delete from public.window_notes where id = p_note_id and author_id = (select auth.uid());
  get diagnostics removed = row_count;
  return removed > 0;
end;
$$;

-- Your notes plus notes from members you follow.
create function public.get_window_notes()
returns table (id uuid, author_id uuid, author_name text, avatar_path text, body text, created_at timestamptz, mine boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.author_id, pr.display_name, pr.avatar_path, n.body, n.created_at, n.author_id = (select auth.uid())
  from public.window_notes n
  join public.profiles pr on pr.id = n.author_id
  where (select auth.uid()) is not null
    and (
      n.author_id = (select auth.uid())
      or exists (
        select 1 from public.member_follows f
        where f.follower_id = (select auth.uid()) and f.followee_id = n.author_id
      )
    )
  order by n.created_at desc
  limit 50;
$$;

revoke all on function public.post_window_note(text) from public;
revoke all on function public.delete_window_note(uuid) from public;
revoke all on function public.get_window_notes() from public;
grant execute on function public.post_window_note(text) to authenticated;
grant execute on function public.delete_window_note(uuid) to authenticated;
grant execute on function public.get_window_notes() to authenticated;