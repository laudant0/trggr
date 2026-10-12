-- Optional X (Twitter) handle on a profile. Only the handle is stored, never a free-form URL,
-- so the link shown to others is always https://x.com/<handle>.

alter table public.profiles
  add column x_handle text check (x_handle is null or x_handle ~ '^[A-Za-z0-9_]{1,15}$');

create function public.get_my_x_handle()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.x_handle from public.profiles p where p.id = (select auth.uid());
$$;

create function public.set_my_x_handle(p_handle text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  cleaned text := nullif(regexp_replace(btrim(coalesce(p_handle, '')), '^@', ''), '');
begin
  if uid is null then
    raise exception 'sign_in_required' using errcode = '28000';
  end if;
  if cleaned is not null and cleaned !~ '^[A-Za-z0-9_]{1,15}$' then
    raise exception 'Enter a valid X handle: letters, numbers and underscores, up to 15 characters.' using errcode = 'P0001';
  end if;
  update public.profiles set x_handle = cleaned where id = uid;
  return cleaned;
end;
$$;

-- Visible only on discoverable profiles, and never to someone the member has blocked.
create function public.get_member_x_handle(p_member_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.x_handle
  from public.profiles p
  where p.id = p_member_id
    and p.discoverable
    and not exists (
      select 1 from public.member_blocks b
      where b.blocker_id = p.id and b.blocked_id = (select auth.uid())
    );
$$;

revoke all on function public.get_my_x_handle() from public;
revoke all on function public.set_my_x_handle(text) from public;
revoke all on function public.get_member_x_handle(uuid) from public;
grant execute on function public.get_my_x_handle() to authenticated;
grant execute on function public.set_my_x_handle(text) to authenticated;
grant execute on function public.get_member_x_handle(uuid) to anon, authenticated;

-- Optional Instagram handle, stored the same way (handle only, never a free-form URL).
alter table public.profiles
  add column instagram_handle text check (instagram_handle is null or instagram_handle ~ '^[A-Za-z0-9_.]{1,30}$');

create function public.get_my_instagram_handle()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.instagram_handle from public.profiles p where p.id = (select auth.uid());
$$;

create function public.set_my_instagram_handle(p_handle text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  cleaned text := nullif(regexp_replace(btrim(coalesce(p_handle, '')), '^@', ''), '');
begin
  if uid is null then
    raise exception 'sign_in_required' using errcode = '28000';
  end if;
  if cleaned is not null and cleaned !~ '^[A-Za-z0-9_.]{1,30}$' then
    raise exception 'Enter a valid Instagram handle: letters, numbers, periods and underscores, up to 30 characters.' using errcode = 'P0001';
  end if;
  update public.profiles set instagram_handle = cleaned where id = uid;
  return cleaned;
end;
$$;

create function public.get_member_instagram_handle(p_member_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.instagram_handle
  from public.profiles p
  where p.id = p_member_id
    and p.discoverable
    and not exists (
      select 1 from public.member_blocks b
      where b.blocker_id = p.id and b.blocked_id = (select auth.uid())
    );
$$;

revoke all on function public.get_my_instagram_handle() from public;
revoke all on function public.set_my_instagram_handle(text) from public;
revoke all on function public.get_member_instagram_handle(uuid) from public;
grant execute on function public.get_my_instagram_handle() to authenticated;
grant execute on function public.set_my_instagram_handle(text) to authenticated;
grant execute on function public.get_member_instagram_handle(uuid) to anon, authenticated;