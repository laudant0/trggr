insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('poll-option-images', 'poll-option-images', true, 524288, array['image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Members upload their own poll option images" on storage.objects;
create policy "Members upload their own poll option images"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'poll-option-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and (storage.foldername(name))[2] is null
  and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$'
);

drop policy if exists "Members remove their own poll option images" on storage.objects;
create policy "Members remove their own poll option images"
on storage.objects for delete to authenticated
using (
  bucket_id = 'poll-option-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

alter table public.poll_options
  add column image_path text;

create or replace function public.get_public_polls()
returns table (
  id uuid,
  question text,
  category text,
  tag text,
  creator text,
  created_at timestamptz,
  options jsonb,
  total_votes bigint,
  my_option_position smallint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.question,
    p.category,
    p.tag,
    coalesce(
      case when pr.discoverable then pr.display_name end,
      'TRGGA community'
    ) as creator,
    p.created_at,
    option_data.options,
    option_data.total_votes,
    own_vote.position as my_option_position
  from public.polls p
  left join public.profiles pr on pr.id = p.created_by
  cross join lateral (
    select
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', po.id,
            'label', po.label,
            'position', po.position,
            'image_path', po.image_path,
            'votes', coalesce(counts.vote_count, 0)
          ) order by po.position
        ),
        '[]'::jsonb
      ) as options,
      coalesce(sum(counts.vote_count), 0)::bigint as total_votes
    from public.poll_options po
    left join lateral (
      select count(*)::bigint as vote_count
      from public.poll_votes v
      where v.option_id = po.id
    ) counts on true
    where po.poll_id = p.id
  ) option_data
  left join lateral (
    select po.position
    from public.poll_votes v
    join public.poll_options po on po.id = v.option_id and po.poll_id = v.poll_id
    where v.poll_id = p.id and v.user_id = (select auth.uid())
    limit 1
  ) own_vote on true
  where p.status = 'published'
  order by p.created_at desc, p.id;
$$;

drop function public.create_poll_with_options(text, text, text[]);

create function public.create_poll_with_options(
  p_question text,
  p_category text,
  p_options text[],
  p_option_images text[] default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  new_poll_id uuid;
  option_count integer;
begin
  if current_user_id is null then
    raise exception 'authentication_required' using errcode = '28000';
  end if;
  if p_question is null or char_length(btrim(p_question)) not between 5 and 110 then
    raise exception 'invalid_question' using errcode = '22023';
  end if;
  if not exists (select 1 from public.poll_categories c where c.name = p_category) then
    raise exception 'invalid_category' using errcode = '22023';
  end if;

  option_count := coalesce(cardinality(p_options), 0);
  if option_count not between 2 and 4
    or exists (
      select 1 from unnest(p_options) option_label
      where option_label is null or char_length(btrim(option_label)) not between 1 and 40
    )
    or (
      select count(distinct lower(btrim(option_label))) from unnest(p_options) option_label
    ) <> option_count then
    raise exception 'invalid_options' using errcode = '22023';
  end if;

  if p_option_images is not null and cardinality(p_option_images) <> option_count then
    raise exception 'invalid_option_images' using errcode = '22023';
  end if;

  if p_option_images is not null and exists (
    select 1
    from unnest(p_option_images) as option_images(image_path)
    where option_images.image_path is not null
      and (
        split_part(option_images.image_path, '/', 1) <> current_user_id::text
        or split_part(option_images.image_path, '/', 2) !~ '^[0-9a-f-]{36}\.webp$'
        or not exists (
          select 1
          from storage.objects image
          where image.bucket_id = 'poll-option-images'
            and image.name = option_images.image_path
            and image.metadata ->> 'mimetype' = 'image/webp'
            and nullif(image.metadata ->> 'size', '')::bigint <= 524288
        )
      )
  ) then
    raise exception 'invalid_option_image' using errcode = '22023';
  end if;

  insert into public.polls (created_by, question, category)
  values (current_user_id, btrim(p_question), p_category)
  returning id into new_poll_id;

  insert into public.poll_options (poll_id, label, position, image_path)
  select
    new_poll_id,
    btrim(options.option_label),
    (options.option_index - 1)::smallint,
    case
      when p_option_images is null then null
      else p_option_images[options.option_index::integer]
    end
  from unnest(p_options) with ordinality as options(option_label, option_index);

  return new_poll_id;
end;
$$;

revoke all on function public.get_public_polls() from public;
revoke all on function public.create_poll_with_options(text, text, text[], text[]) from public;
grant execute on function public.get_public_polls() to anon, authenticated;
grant execute on function public.create_poll_with_options(text, text, text[], text[]) to authenticated;
