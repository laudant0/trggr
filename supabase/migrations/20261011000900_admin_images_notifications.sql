-- Admin poll images and member notifications (new followers, vote milestones).

-- 1. Admin official polls can now carry option images (uploaded by the admin to their own folder).
drop function if exists public.admin_create_poll(text, text, text[], text, timestamptz);
create function public.admin_create_poll(
  p_question text,
  p_category text,
  p_options text[],
  p_tag text default 'OFFICIAL POLL',
  p_closes_at timestamptz default null,
  p_option_images text[] default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_poll_id uuid;
  option_count integer := coalesce(cardinality(p_options), 0);
  admin_id uuid := (select auth.uid());
begin
  if not public.is_admin() then
    raise exception 'admin_only' using errcode = '42501';
  end if;
  if p_question is null or char_length(btrim(p_question)) not between 5 and 110 then
    raise exception 'invalid_question' using errcode = '22023';
  end if;
  if not exists (select 1 from public.poll_categories c where c.name = p_category) then
    raise exception 'invalid_category' using errcode = '22023';
  end if;
  if p_tag is null or char_length(btrim(p_tag)) not between 1 and 30 then
    raise exception 'invalid_tag' using errcode = '22023';
  end if;
  if option_count not between 2 and 4
    or exists (select 1 from unnest(p_options) l where l is null or char_length(btrim(l)) not between 1 and 40)
    or (select count(distinct lower(btrim(l))) from unnest(p_options) l) <> option_count then
    raise exception 'invalid_options' using errcode = '22023';
  end if;
  if p_closes_at is not null and p_closes_at < now() + interval '10 minutes' then
    raise exception 'invalid_closing_time' using errcode = '22023';
  end if;
  if p_option_images is not null and cardinality(p_option_images) <> option_count then
    raise exception 'invalid_option_images' using errcode = '22023';
  end if;
  if p_option_images is not null and exists (
    select 1
    from unnest(p_option_images) as option_images(image_path)
    where option_images.image_path is not null
      and (
        split_part(option_images.image_path, '/', 1) <> admin_id::text
        or split_part(option_images.image_path, '/', 2) !~ '^[0-9a-f-]{36}\.webp$'
        or not exists (
          select 1
          from storage.objects image
          where image.bucket_id = 'poll-option-images'
            and image.name = option_images.image_path
        )
      )
  ) then
    raise exception 'invalid_option_image' using errcode = '22023';
  end if;

  insert into public.polls (created_by, question, category, tag, official, closes_at)
  values (null, btrim(p_question), p_category, upper(btrim(p_tag)), true, p_closes_at)
  returning id into new_poll_id;

  insert into public.poll_options (poll_id, label, position, image_path)
  select
    new_poll_id,
    btrim(o.label),
    (o.idx - 1)::smallint,
    case when p_option_images is null then null else p_option_images[o.idx::integer] end
  from unnest(p_options) with ordinality as o(label, idx);

  return new_poll_id;
end;
$$;
revoke all on function public.admin_create_poll(text, text, text[], text, timestamptz, text[]) from public;
grant execute on function public.admin_create_poll(text, text, text[], text, timestamptz, text[]) to authenticated;

-- 2. Notifications.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('follow', 'votes')),
  actor_id uuid references auth.users (id) on delete cascade,
  poll_id uuid references public.polls (id) on delete cascade,
  detail integer,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_user_recent_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;

create function public.notify_on_follow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, kind, actor_id)
  values (new.followee_id, 'follow', new.follower_id);
  return new;
end;
$$;
create trigger member_follows_notify
after insert on public.member_follows
for each row execute function public.notify_on_follow();

create function public.notify_on_vote_milestone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
  total integer;
begin
  select p.created_by into owner_id from public.polls p where p.id = new.poll_id;
  if owner_id is null then
    return new;
  end if;
  select count(*)::integer into total from public.poll_votes v where v.poll_id = new.poll_id;
  if total in (5, 10, 25, 50, 100, 250, 500, 1000) then
    insert into public.notifications (user_id, kind, poll_id, detail)
    values (owner_id, 'votes', new.poll_id, total);
  end if;
  return new;
end;
$$;
create trigger poll_votes_notify
after insert on public.poll_votes
for each row execute function public.notify_on_vote_milestone();

create function public.get_my_notifications()
returns table (
  id uuid,
  kind text,
  actor_id uuid,
  actor_name text,
  poll_id uuid,
  poll_question text,
  detail integer,
  created_at timestamptz,
  is_read boolean
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
    n.id,
    n.kind,
    n.actor_id,
    pr.display_name,
    n.poll_id,
    p.question,
    n.detail,
    n.created_at,
    n.read_at is not null
  from public.notifications n
  left join public.profiles pr on pr.id = n.actor_id
  left join public.polls p on p.id = n.poll_id
  where n.user_id = (select auth.uid())
  order by n.created_at desc
  limit 50;
end;
$$;

create function public.get_unread_notification_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.notifications n
  where n.user_id = (select auth.uid()) and n.read_at is null;
$$;

create function public.mark_notifications_read()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notifications n
  set read_at = now()
  where n.user_id = (select auth.uid()) and n.read_at is null;
$$;

revoke all on function public.get_my_notifications() from public;
revoke all on function public.get_unread_notification_count() from public;
revoke all on function public.mark_notifications_read() from public;
revoke all on function public.notify_on_follow() from public;
revoke all on function public.notify_on_vote_milestone() from public;
grant execute on function public.get_my_notifications() to authenticated;
grant execute on function public.get_unread_notification_count() to authenticated;
grant execute on function public.mark_notifications_read() to authenticated;
