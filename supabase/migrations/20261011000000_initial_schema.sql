create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 60),
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.poll_categories (
  name text primary key check (char_length(name) between 1 and 40),
  sort_order smallint not null unique check (sort_order > 0)
);

create table public.polls (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users (id) on delete set null,
  question text not null check (char_length(btrim(question)) between 5 and 110),
  category text not null references public.poll_categories (name),
  tag text not null default 'COMMUNITY QUESTION',
  status text not null default 'published' check (status in ('published', 'hidden')),
  created_at timestamptz not null default now()
);

create index polls_public_recent_idx on public.polls (created_at desc) where status = 'published';
create index polls_creator_recent_idx on public.polls (created_by, created_at desc);

create table public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls (id) on delete cascade,
  label text not null check (char_length(btrim(label)) between 1 and 40),
  position smallint not null check (position between 0 and 1),
  unique (poll_id, position),
  unique (id, poll_id)
);

create table public.poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls (id) on delete cascade,
  option_id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (poll_id, user_id),
  foreign key (option_id, poll_id) references public.poll_options (id, poll_id) on delete cascade
);

create index poll_votes_poll_idx on public.poll_votes (poll_id);
create index poll_votes_option_idx on public.poll_votes (option_id);

create table public.poll_reports (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls (id) on delete cascade,
  reporter_id uuid not null references auth.users (id) on delete cascade,
  reason text not null check (reason in ('spam', 'harassment', 'hate', 'misinformation', 'other')),
  details text check (details is null or char_length(details) <= 500),
  created_at timestamptz not null default now(),
  unique (poll_id, reporter_id)
);

create index poll_reports_recent_idx on public.poll_reports (created_at desc);

alter table public.profiles enable row level security;
alter table public.poll_categories enable row level security;
alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;
alter table public.poll_reports enable row level security;

revoke all on public.profiles, public.poll_categories, public.polls, public.poll_options, public.poll_votes, public.poll_reports from anon, authenticated;

create function public.handle_new_user()
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
    'TRGGR member'
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.get_public_categories()
returns table (name text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.name
  from public.poll_categories c
  order by c.sort_order, c.name;
$$;

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
    coalesce(pr.display_name, 'TRGGR desk') as creator,
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

create function public.create_poll(
  p_question text,
  p_category text,
  p_option_one text,
  p_option_two text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_poll_id uuid;
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
  if p_option_one is null or char_length(btrim(p_option_one)) not between 1 and 40
    or p_option_two is null or char_length(btrim(p_option_two)) not between 1 and 40 then
    raise exception 'invalid_options' using errcode = '22023';
  end if;
  if lower(btrim(p_option_one)) = lower(btrim(p_option_two)) then
    raise exception 'options_must_differ' using errcode = '22023';
  end if;

  insert into public.polls (created_by, question, category)
  values ((select auth.uid()), btrim(p_question), p_category)
  returning id into new_poll_id;

  insert into public.poll_options (poll_id, label, position)
  values
    (new_poll_id, btrim(p_option_one), 0),
    (new_poll_id, btrim(p_option_two), 1);

  return new_poll_id;
end;
$$;

create function public.vote_on_poll(p_poll_id uuid, p_option_id uuid)
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

  insert into public.poll_votes (poll_id, option_id, user_id)
  values (p_poll_id, p_option_id, vote_user_id)
  on conflict (poll_id, user_id) do nothing;

  get diagnostics inserted_count = row_count;

  select count(*) into current_total
  from public.poll_votes v
  where v.poll_id = p_poll_id;

  return jsonb_build_object(
    'recorded', inserted_count = 1,
    'total_votes', current_total
  );
end;
$$;

create function public.report_poll(p_poll_id uuid, p_reason text, p_details text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_report_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if p_reason not in ('spam', 'harassment', 'hate', 'misinformation', 'other')
    or (p_details is not null and char_length(p_details) > 500) then
    raise exception 'invalid_report' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.polls p where p.id = p_poll_id and p.status = 'published'
  ) then
    raise exception 'poll_not_found' using errcode = '22023';
  end if;

  insert into public.poll_reports (poll_id, reporter_id, reason, details)
  values (p_poll_id, (select auth.uid()), p_reason, nullif(btrim(p_details), ''))
  on conflict (poll_id, reporter_id) do nothing
  returning id into new_report_id;

  return new_report_id;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.get_public_categories() from public;
revoke all on function public.get_public_polls() from public;
revoke all on function public.create_poll(text, text, text, text) from public;
revoke all on function public.vote_on_poll(uuid, uuid) from public;
revoke all on function public.report_poll(uuid, text, text) from public;
grant execute on function public.get_public_categories() to anon, authenticated;
grant execute on function public.get_public_polls() to anon, authenticated;
grant execute on function public.create_poll(text, text, text, text) to authenticated;
grant execute on function public.vote_on_poll(uuid, uuid) to authenticated;
grant execute on function public.report_poll(uuid, text, text) to authenticated;

insert into public.poll_categories (name, sort_order)
values
  ('Arts', 1),
  ('Automotive', 2),
  ('Books', 3),
  ('Business', 4),
  ('Creators', 5),
  ('Culture', 6),
  ('Education', 7),
  ('Entertainment', 8),
  ('Environment', 9),
  ('Fashion', 10),
  ('Finance', 11),
  ('Food', 12),
  ('Gaming', 13),
  ('Health', 14),
  ('Lifestyle', 15),
  ('Music', 16),
  ('News', 17),
  ('Other', 18),
  ('Politics', 19),
  ('Relationships', 20),
  ('Science', 21),
  ('Sports', 22),
  ('Tech', 23),
  ('Travel', 24),
  ('World', 25);

insert into public.polls (id, question, category, tag)
values
  ('10000000-0000-4000-8000-000000000001', 'Is the internet over celebrity culture?', 'Culture', 'THE DAILY PULSE'),
  ('10000000-0000-4000-8000-000000000002', 'The greatest to ever touch a court?', 'Sports', 'THE GOAT DEBATE'),
  ('10000000-0000-4000-8000-000000000003', 'An album should be no more than…', 'Music', 'STUDIO TALK'),
  ('10000000-0000-4000-8000-000000000004', 'Would you trust AI to plan your whole week?', 'Tech', 'FUTURE CHECK'),
  ('10000000-0000-4000-8000-000000000005', 'Festival season: worth the price tag?', 'Culture', 'CULTURE CHECK'),
  ('10000000-0000-4000-8000-000000000006', 'Should athletes have to talk to the press?', 'Sports', 'AFTER THE WHISTLE'),
  ('10000000-0000-4000-8000-000000000007', 'Should a phone last longer than two years?', 'Tech', 'FUTURE CHECK'),
  ('10000000-0000-4000-8000-000000000008', 'Will humans live on Mars in your lifetime?', 'Science', 'BIG QUESTION');

insert into public.poll_options (poll_id, label, position)
values
  ('10000000-0000-4000-8000-000000000001', 'Yes, let it go', 0),
  ('10000000-0000-4000-8000-000000000001', 'No, give us more', 1),
  ('10000000-0000-4000-8000-000000000002', 'Michael Jordan', 0),
  ('10000000-0000-4000-8000-000000000002', 'LeBron James', 1),
  ('10000000-0000-4000-8000-000000000003', '10 tracks. No skips.', 0),
  ('10000000-0000-4000-8000-000000000003', 'Let the artist cook.', 1),
  ('10000000-0000-4000-8000-000000000004', 'Already do', 0),
  ('10000000-0000-4000-8000-000000000004', 'Absolutely not', 1),
  ('10000000-0000-4000-8000-000000000005', 'Every single time', 0),
  ('10000000-0000-4000-8000-000000000005', 'I''ll stream it', 1),
  ('10000000-0000-4000-8000-000000000006', 'Part of the job', 0),
  ('10000000-0000-4000-8000-000000000006', 'Let them play', 1),
  ('10000000-0000-4000-8000-000000000007', 'Make it last', 0),
  ('10000000-0000-4000-8000-000000000007', 'Ready for the new one', 1),
  ('10000000-0000-4000-8000-000000000008', 'I''m betting yes', 0),
  ('10000000-0000-4000-8000-000000000008', 'Not a chance', 1);
