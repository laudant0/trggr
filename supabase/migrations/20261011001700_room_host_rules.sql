-- Only a poll's author can host its room; admins host official polls.
create or replace function public.create_room(p_poll_id uuid, p_title text, p_starts_at timestamptz default null)
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
  target record;
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
  select p.created_by, p.official into target
  from public.polls p
  where p.id = p_poll_id and p.status = 'published';
  if not found then
    raise exception 'That poll is not available.';
  end if;
  if not (target.created_by = uid or (target.official and public.is_admin())) then
    raise exception 'Only the author of a poll can start its room.';
  end if;
  if exists (select 1 from public.rooms r where r.poll_id = p_poll_id and r.status <> 'ended') then
    raise exception 'This poll already has an open room.';
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

-- Polls the signed-in member is allowed to host a room on.
create function public.get_my_hostable_polls()
returns table (poll_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return;
  end if;
  return query
  select p.id
  from public.polls p
  where p.status = 'published'
    and (p.created_by = (select auth.uid()) or (p.official and public.is_admin()));
end;
$$;

revoke all on function public.get_my_hostable_polls() from public;
grant execute on function public.get_my_hostable_polls() to authenticated;
