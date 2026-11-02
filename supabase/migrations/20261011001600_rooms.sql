-- Rooms: live audio conversations attached to a poll.
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls (id) on delete cascade,
  host_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 3 and 80),
  starts_at timestamptz not null default now(),
  status text not null default 'live' check (status in ('scheduled', 'live', 'ended')),
  created_at timestamptz not null default now()
);
create index rooms_open_idx on public.rooms (status, starts_at desc);
alter table public.rooms enable row level security;
revoke all on public.rooms from anon, authenticated;

create function public.create_room(p_poll_id uuid, p_title text, p_starts_at timestamptz default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  new_id uuid;
  clean_title text := btrim(coalesce(p_title, ''));
  start_time timestamptz := coalesce(p_starts_at, now());
begin
  if uid is null then
    raise exception 'sign_in_required' using errcode = '28000';
  end if;
  if char_length(clean_title) not between 3 and 80 then
    raise exception 'Give the room a title between 3 and 80 characters.';
  end if;
  if start_time > now() + interval '14 days' then
    raise exception 'Rooms can be scheduled up to 14 days ahead.';
  end if;
  if not exists (select 1 from public.polls p where p.id = p_poll_id and p.status = 'published') then
    raise exception 'That poll is not available.';
  end if;
  if (select count(*) from public.rooms r where r.host_id = uid and r.status <> 'ended') >= 3 then
    raise exception 'You already have 3 open rooms. End one first.';
  end if;
  insert into public.rooms (poll_id, host_id, title, starts_at, status)
  values (p_poll_id, uid, clean_title, start_time, case when start_time > now() + interval '1 minute' then 'scheduled' else 'live' end)
  returning id into new_id;
  return new_id;
end;
$$;

create function public.get_rooms()
returns table (
  id uuid,
  poll_id uuid,
  poll_question text,
  host_id uuid,
  host_name text,
  title text,
  starts_at timestamptz,
  status text,
  is_host boolean,
  join_key text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'sign_in_required' using errcode = '28000';
  end if;
  return query
  select
    r.id,
    r.poll_id,
    p.question,
    r.host_id,
    coalesce(pr.display_name, 'Member'),
    r.title,
    r.starts_at,
    case when r.status = 'scheduled' and r.starts_at <= now() then 'live' else r.status end,
    r.host_id = (select auth.uid()),
    'trgga-' || replace(r.id::text, '-', '')
  from public.rooms r
  join public.polls p on p.id = r.poll_id
  left join public.profiles pr on pr.id = r.host_id
  where r.status <> 'ended'
    and r.starts_at > now() - interval '6 hours'
  order by (r.starts_at <= now()) desc, r.starts_at asc
  limit 40;
end;
$$;

create function public.end_room(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'sign_in_required' using errcode = '28000';
  end if;
  update public.rooms r
  set status = 'ended'
  where r.id = p_id
    and (r.host_id = (select auth.uid()) or public.is_admin());
end;
$$;

revoke all on function public.create_room(uuid, text, timestamptz) from public;
revoke all on function public.get_rooms() from public;
revoke all on function public.end_room(uuid) from public;
grant execute on function public.create_room(uuid, text, timestamptz) to authenticated;
grant execute on function public.get_rooms() to authenticated;
grant execute on function public.end_room(uuid) to authenticated;
