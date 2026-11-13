-- Add topics without disturbing categories already configured by the site owner.
with additions(name, position) as (
  values ('Careers', 1), ('Movies', 2), ('Parenting', 3), ('Pets', 4), ('Wellness', 5)
), missing as (
  select a.name, a.position
  from additions a
  where not exists (select 1 from public.poll_categories c where c.name = a.name)
), base as (
  select coalesce(max(sort_order), 0) as last_order from public.poll_categories
)
insert into public.poll_categories (name, sort_order)
select m.name, (base.last_order + row_number() over (order by m.position))::smallint
from missing m cross join base;

-- One extra row tells the client whether another page exists.
create function public.get_discoverable_profiles_page(p_search text default null, p_offset integer default 0)
returns table (
  id uuid,
  display_name text,
  bio text,
  avatar_url text,
  created_at timestamptz,
  polls_created bigint,
  votes_received bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    pr.id,
    pr.display_name,
    pr.bio,
    pr.avatar_url,
    pr.created_at,
    count(distinct p.id)::bigint as polls_created,
    count(v.id)::bigint as votes_received
  from public.profiles pr
  left join public.polls p on p.created_by = pr.id and p.status = 'published'
  left join public.poll_options po on po.poll_id = p.id
  left join public.poll_votes v on v.option_id = po.id
  where pr.discoverable
    and not public.is_blocked_pair((select auth.uid()), pr.id)
    and (
      nullif(btrim(p_search), '') is null
      or (
        char_length(btrim(p_search)) <= 60
        and (
          pr.display_name ilike '%' || btrim(p_search) || '%'
          or pr.bio ilike '%' || btrim(p_search) || '%'
        )
      )
    )
  group by pr.id
  order by count(distinct p.id) desc, pr.created_at desc, pr.id
  limit 13 offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function public.get_discoverable_profiles_page(text, integer) from public;
grant execute on function public.get_discoverable_profiles_page(text, integer) to anon, authenticated;
