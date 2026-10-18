-- Admin dashboard: platform overview, per-poll performance, close-now, newest members.

create function public.admin_get_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin_only' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'members', (select count(*) from public.profiles),
    'new_members_7d', (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'polls', (select count(*) from public.polls where status = 'published'),
    'official_polls', (select count(*) from public.polls where status = 'published' and official),
    'votes', (select count(*) from public.poll_votes),
    'votes_24h', (select count(*) from public.poll_votes where created_at > now() - interval '24 hours'),
    'votes_7d', (select count(*) from public.poll_votes where created_at > now() - interval '7 days'),
    'takes', (select count(*) from public.poll_takes),
    'open_member_reports', (select count(*) from public.support_reports where status = 'open'),
    'reported_polls', (select count(distinct poll_id) from public.poll_reports),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'day', d.day,
        'votes', (select count(*) from public.poll_votes v where v.created_at >= d.day and v.created_at < d.day + 1),
        'members', (select count(*) from public.profiles p where p.created_at >= d.day and p.created_at < d.day + 1)
      ) order by d.day), '[]'::jsonb)
      from (select generate_series(current_date - 13, current_date, interval '1 day')::date as day) d
    )
  ) into result;

  return result;
end;
$$;

create function public.admin_get_poll_stats(p_official_only boolean default false)
returns table (
  poll_id uuid,
  question text,
  official boolean,
  tag text,
  status text,
  created_at timestamptz,
  closes_at timestamptz,
  total_votes bigint,
  votes_24h bigint,
  take_count bigint,
  report_count bigint,
  options jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin_only' using errcode = '42501';
  end if;

  return query
  select
    p.id,
    p.question,
    p.official,
    p.tag,
    p.status,
    p.created_at,
    p.closes_at,
    (select count(*) from public.poll_votes v where v.poll_id = p.id),
    (select count(*) from public.poll_votes v where v.poll_id = p.id and v.created_at > now() - interval '24 hours'),
    (select count(*) from public.poll_takes t where t.poll_id = p.id),
    (select count(*) from public.poll_reports r where r.poll_id = p.id),
    (
      select coalesce(jsonb_agg(jsonb_build_object(
        'label', o.label,
        'votes', (select count(*) from public.poll_votes v where v.option_id = o.id)
      ) order by o.position), '[]'::jsonb)
      from public.poll_options o
      where o.poll_id = p.id
    )
  from public.polls p
  where (not p_official_only or p.official)
  order by 8 desc, p.created_at desc
  limit 100;
end;
$$;

create function public.admin_close_poll(p_poll_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin_only' using errcode = '42501';
  end if;
  update public.polls set closes_at = now() where id = p_poll_id;
end;
$$;

create function public.admin_get_new_members()
returns table (member_id uuid, display_name text, created_at timestamptz, votes bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin_only' using errcode = '42501';
  end if;

  return query
  select p.id, p.display_name, p.created_at,
    (select count(*) from public.poll_votes v where v.user_id = p.id)
  from public.profiles p
  order by p.created_at desc
  limit 15;
end;
$$;

revoke all on function public.admin_get_overview() from public;
revoke all on function public.admin_get_poll_stats(boolean) from public;
revoke all on function public.admin_close_poll(uuid) from public;
revoke all on function public.admin_get_new_members() from public;
grant execute on function public.admin_get_overview() to authenticated;
grant execute on function public.admin_get_poll_stats(boolean) to authenticated;
grant execute on function public.admin_close_poll(uuid) to authenticated;
grant execute on function public.admin_get_new_members() to authenticated;
