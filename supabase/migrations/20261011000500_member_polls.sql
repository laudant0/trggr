-- Polls started by a discoverable member, in the same shape as the public feed.
create function public.get_member_polls(p_profile_id uuid)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(f)
  from public.get_public_polls() f
  where f.id in (
    select p.id
    from public.polls p
    join public.profiles pr on pr.id = p.created_by
    where p.created_by = p_profile_id and pr.discoverable and p.status = 'published'
  )
  order by f.created_at desc;
$$;

-- Maps polls to their creator's profile id, only for discoverable creators.
create function public.get_poll_creator_links()
returns table (poll_id uuid, creator_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.created_by
  from public.polls p
  join public.profiles pr on pr.id = p.created_by
  where p.status = 'published' and pr.discoverable;
$$;

revoke all on function public.get_member_polls(uuid) from public;
revoke all on function public.get_poll_creator_links() from public;
grant execute on function public.get_member_polls(uuid) to anon, authenticated;
grant execute on function public.get_poll_creator_links() to anon, authenticated;
