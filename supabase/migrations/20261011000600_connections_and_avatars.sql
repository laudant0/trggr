-- Profile photos: public bucket, one WebP up to 256 KB per upload, owner-only writes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 262144, array['image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Members upload their own avatars" on storage.objects;
create policy "Members upload their own avatars"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$'
);

drop policy if exists "Members remove their own avatars" on storage.objects;
create policy "Members remove their own avatars"
on storage.objects for delete to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Stores the avatar path (not a free-form URL) so only files the member uploaded can be used.
alter table public.profiles add column avatar_path text;

create function public.set_my_avatar(p_path text)
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
  if p_path is not null and p_path !~ ('^' || uid::text || '/[0-9a-f-]{36}\.webp$') then
    raise exception 'invalid_avatar_path' using errcode = '22023';
  end if;
  update public.profiles set avatar_path = p_path where id = uid;
end;
$$;

-- Connections: a member follows other discoverable members.
create table public.member_follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index member_follows_followee_idx on public.member_follows (followee_id, created_at desc);
alter table public.member_follows enable row level security;
revoke all on public.member_follows from anon, authenticated;

create function public.toggle_follow(p_member_id uuid)
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

-- Counts for any discoverable member (or yourself) plus the caller's relationship to them.
create function public.get_connection_state(p_member_id uuid)
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
    'followers', (select count(*) from public.member_follows where followee_id = p_member_id),
    'following', (
      select count(*) from public.member_follows f
      join public.profiles pr on pr.id = f.followee_id
      where f.follower_id = p_member_id and pr.discoverable
    ),
    'i_follow', uid is not null and exists (
      select 1 from public.member_follows where follower_id = uid and followee_id = p_member_id
    ),
    'follows_me', uid is not null and exists (
      select 1 from public.member_follows where follower_id = p_member_id and followee_id = uid
    )
  );
end;
$$;

-- People the caller follows, or who follow the caller, who are visible in the directory.
create function public.get_my_connections(p_kind text)
returns table (id uuid, display_name text, avatar_path text, bio text, mutual boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select pr.id, pr.display_name, pr.avatar_path, pr.bio,
    exists (
      select 1 from public.member_follows b
      where (p_kind = 'following' and b.follower_id = f.followee_id and b.followee_id = (select auth.uid()))
         or (p_kind = 'followers' and b.follower_id = (select auth.uid()) and b.followee_id = f.follower_id)
    ) as mutual
  from public.member_follows f
  join public.profiles pr on pr.id = case when p_kind = 'following' then f.followee_id else f.follower_id end
  where (select auth.uid()) is not null
    and p_kind in ('following', 'followers')
    and pr.discoverable
    and case when p_kind = 'following' then f.follower_id else f.followee_id end = (select auth.uid())
  order by f.created_at desc
  limit 200;
$$;

-- Avatar paths for any profile ids the client already shows (discoverable or self only).
create function public.get_avatar_paths(p_ids uuid[])
returns table (id uuid, avatar_path text)
language sql
stable
security definer
set search_path = ''
as $$
  select pr.id, pr.avatar_path
  from public.profiles pr
  where pr.id = any (p_ids) and pr.avatar_path is not null
    and (pr.discoverable or pr.id = (select auth.uid()));
$$;

revoke all on function public.set_my_avatar(text) from public;
revoke all on function public.toggle_follow(uuid) from public;
revoke all on function public.get_connection_state(uuid) from public;
revoke all on function public.get_my_connections(text) from public;
revoke all on function public.get_avatar_paths(uuid[]) from public;
grant execute on function public.set_my_avatar(text) to authenticated;
grant execute on function public.toggle_follow(uuid) to authenticated;
grant execute on function public.get_connection_state(uuid) to anon, authenticated;
grant execute on function public.get_my_connections(text) to authenticated;
grant execute on function public.get_avatar_paths(uuid[]) to anon, authenticated;
