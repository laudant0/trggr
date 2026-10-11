-- Performance indexes for feeds, topic filters, results and moderation.
create index if not exists polls_category_recent_idx
  on public.polls (category, created_at desc) where status = 'published';
create index if not exists poll_options_poll_idx on public.poll_options (poll_id);
create index if not exists poll_reports_poll_idx on public.poll_reports (poll_id);
create index if not exists poll_reports_reporter_idx on public.poll_reports (reporter_id, created_at desc);

-- Abuse protection: per-account rate limits enforced inside the database.
create or replace function public.enforce_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent_count integer;
begin
  if tg_table_name = 'polls' then
    select count(*) into recent_count from public.polls
      where created_by = new.created_by and created_at > now() - interval '1 hour';
    if recent_count >= 10 then
      raise exception 'You are creating polls too quickly. Try again later.' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'poll_votes' then
    select count(*) into recent_count from public.poll_votes
      where user_id = new.user_id and created_at > now() - interval '1 hour';
    if recent_count >= 120 then
      raise exception 'You are voting too quickly. Try again later.' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'poll_reports' then
    select count(*) into recent_count from public.poll_reports
      where reporter_id = new.reporter_id and created_at > now() - interval '1 day';
    if recent_count >= 20 then
      raise exception 'Report limit reached for today.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists polls_rate_limit on public.polls;
create trigger polls_rate_limit before insert on public.polls
  for each row when (new.created_by is not null) execute function public.enforce_rate_limit();
drop trigger if exists poll_votes_rate_limit on public.poll_votes;
create trigger poll_votes_rate_limit before insert on public.poll_votes
  for each row execute function public.enforce_rate_limit();
drop trigger if exists poll_reports_rate_limit on public.poll_reports;
create trigger poll_reports_rate_limit before insert on public.poll_reports
  for each row execute function public.enforce_rate_limit();

-- Moderation: five reports from distinct members hide a poll pending review.
create or replace function public.auto_hide_reported_poll()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.poll_reports where poll_id = new.poll_id) >= 5 then
    update public.polls set status = 'hidden' where id = new.poll_id and status = 'published';
  end if;
  return new;
end;
$$;

drop trigger if exists poll_reports_auto_hide on public.poll_reports;
create trigger poll_reports_auto_hide after insert on public.poll_reports
  for each row execute function public.auto_hide_reported_poll();

revoke all on function public.enforce_rate_limit() from public, anon, authenticated;
revoke all on function public.auto_hide_reported_poll() from public, anon, authenticated;
