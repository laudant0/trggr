alter table public.profiles
  add column bio text not null default '' check (char_length(bio) <= 160);

create index poll_votes_user_recent_idx on public.poll_votes (user_id, created_at desc);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  suggested_name text;
begin
  suggested_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'user_name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'TRGGA member'
  );

  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    left(suggested_name, 60),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create function public.get_my_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_profile public.profiles%rowtype;
begin
  if current_user_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;

  select * into current_profile
  from public.profiles p
  where p.id = current_user_id;

  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'display_name', current_profile.display_name,
    'avatar_url', current_profile.avatar_url,
    'bio', current_profile.bio,
    'created_at', current_profile.created_at,
    'stats', jsonb_build_object(
      'polls_created', (
        select count(*) from public.polls p
        where p.created_by = current_user_id and p.status = 'published'
      ),
      'votes_cast', (
        select count(*) from public.poll_votes v
        where v.user_id = current_user_id
      ),
      'votes_received', (
        select count(*)
        from public.poll_votes v
        join public.polls p on p.id = v.poll_id
        where p.created_by = current_user_id and p.status = 'published'
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
        where p.created_by = current_user_id and p.status = 'published'
        group by p.id
        order by p.created_at desc
        limit 5
      ) recent_poll
    ), '[]'::jsonb),
    'recent_votes', coalesce((
      select jsonb_agg(to_jsonb(recent_vote) order by recent_vote.voted_at desc)
      from (
        select
          p.question,
          p.category,
          po.label as option_label,
          v.created_at as voted_at
        from public.poll_votes v
        join public.polls p on p.id = v.poll_id
        join public.poll_options po on po.id = v.option_id
        where v.user_id = current_user_id and p.status = 'published'
        order by v.created_at desc
        limit 5
      ) recent_vote
    ), '[]'::jsonb)
  );
end;
$$;

create function public.update_my_profile(p_display_name text, p_bio text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if p_display_name is null or char_length(btrim(p_display_name)) not between 1 and 60 then
    raise exception 'invalid_display_name' using errcode = '22023';
  end if;
  if p_bio is not null and char_length(btrim(p_bio)) > 160 then
    raise exception 'bio_too_long' using errcode = '22023';
  end if;

  update public.profiles
  set display_name = btrim(p_display_name),
      bio = coalesce(btrim(p_bio), '')
  where id = current_user_id;

  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.get_my_profile() from public;
revoke all on function public.update_my_profile(text, text) from public;
grant execute on function public.get_my_profile() to authenticated;
grant execute on function public.update_my_profile(text, text) to authenticated;
