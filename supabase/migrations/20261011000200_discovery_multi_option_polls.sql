alter table public.profiles
  add column discoverable boolean not null default false;

alter table public.poll_options
  drop constraint poll_options_position_check,
  add constraint poll_options_position_check check (position between 0 and 3);

drop function public.update_my_profile(text, text);

create function public.update_my_profile(
  p_display_name text,
  p_bio text,
  p_discoverable boolean
)
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
      bio = coalesce(btrim(p_bio), ''),
      discoverable = coalesce(p_discoverable, false)
  where id = current_user_id;

  if not found then
    raise exception 'profile_not_found' using errcode = 'P0002';
  end if;
end;
$$;

create function public.get_discoverable_profiles(p_search text default null)
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

create function public.get_public_profile(p_profile_id uuid)
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
  where pr.id = p_profile_id and pr.discoverable;

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
  my_option_position smallint
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
    coalesce(
      case when pr.discoverable then pr.display_name end,
      'TRGGA community'
    ) as creator,
    p.created_at,
    option_data.options,
    option_data.total_votes,
    own_vote.position as my_option_position
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

create function public.get_my_profile_discovery_setting()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select pr.discoverable
  from public.profiles pr
  where pr.id = (select auth.uid());
$$;

create function public.create_poll_with_options(
  p_question text,
  p_category text,
  p_options text[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_poll_id uuid;
  option_count integer;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if p_question is null or char_length(btrim(p_question)) not between 5 and 110 then
    raise exception 'invalid_question' using errcode = '22023';
  end if;
  if not exists (select 1 from public.poll_categories c where c.name = p_category) then
    raise exception 'invalid_category' using errcode = '22023';
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

  insert into public.polls (created_by, question, category)
  values ((select auth.uid()), btrim(p_question), p_category)
  returning id into new_poll_id;

  insert into public.poll_options (poll_id, label, position)
  select new_poll_id, btrim(option_label), (option_index - 1)::smallint
  from unnest(p_options) with ordinality as options(option_label, option_index);

  return new_poll_id;
end;
$$;

revoke all on function public.update_my_profile(text, text, boolean) from public;
revoke all on function public.get_discoverable_profiles(text) from public;
revoke all on function public.get_public_profile(uuid) from public;
revoke all on function public.get_public_polls() from public;
revoke all on function public.get_my_profile_discovery_setting() from public;
revoke all on function public.create_poll_with_options(text, text, text[]) from public;
grant execute on function public.update_my_profile(text, text, boolean) to authenticated;
grant execute on function public.get_discoverable_profiles(text) to anon, authenticated;
grant execute on function public.get_public_profile(uuid) to anon, authenticated;
grant execute on function public.get_public_polls() to anon, authenticated;
grant execute on function public.get_my_profile_discovery_setting() to authenticated;
grant execute on function public.create_poll_with_options(text, text, text[]) to authenticated;
