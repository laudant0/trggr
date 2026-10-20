-- Alerts: tell followers when someone they follow posts a poll.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications
  add constraint notifications_kind_check check (kind in ('follow', 'votes', 'poll'));

create function public.notify_followers_on_poll()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.created_by is null or new.status <> 'published' or new.official then
    return new;
  end if;
  insert into public.notifications (user_id, kind, actor_id, poll_id)
  select f.follower_id, 'poll', new.created_by, new.id
  from public.member_follows f
  where f.followee_id = new.created_by;
  return new;
end;
$$;

revoke all on function public.notify_followers_on_poll() from public;

create trigger polls_notify_followers
after insert on public.polls
for each row execute function public.notify_followers_on_poll();
