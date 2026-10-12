-- Reports now come from a dedicated Report page linked in the footer.
-- Each report needs a link or description plus real detail, and members are
-- limited to 5 per day, so it can't be used to casually flag every poll.

create table public.support_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('poll', 'take', 'member', 'bug', 'other')),
  reference text not null check (char_length(reference) between 3 and 300),
  reason text not null check (reason in ('spam', 'harassment', 'hate', 'misinformation', 'other')),
  details text not null check (char_length(details) between 20 and 1000),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now()
);
create index support_reports_status_idx on public.support_reports (status, created_at desc);
alter table public.support_reports enable row level security;
revoke all on public.support_reports from anon, authenticated;

create function public.submit_report(p_kind text, p_reference text, p_reason text, p_details text)
returns boolean
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
  if p_kind not in ('poll', 'take', 'member', 'bug', 'other')
    or p_reason not in ('spam', 'harassment', 'hate', 'misinformation', 'other')
    or p_reference is null or char_length(btrim(p_reference)) not between 3 and 300 then
    raise exception 'Add a link or a short description of what you are reporting.' using errcode = 'P0001';
  end if;
  if p_details is null or char_length(btrim(p_details)) not between 20 and 1000 then
    raise exception 'Please explain what happened in 20 to 1000 characters.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.support_reports r
      where r.reporter_id = uid and r.created_at > now() - interval '24 hours') >= 5 then
    raise exception 'You have reached the daily report limit. Try again tomorrow.' using errcode = 'P0001';
  end if;
  insert into public.support_reports (reporter_id, kind, reference, reason, details)
  values (uid, p_kind, btrim(p_reference), p_reason, btrim(p_details));
  return true;
end;
$$;

create function public.admin_get_support_reports()
returns table (
  report_id uuid,
  kind text,
  reference text,
  reason text,
  details text,
  reporter_name text,
  status text,
  created_at timestamptz
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
  select r.id, r.kind, r.reference, r.reason, r.details,
    coalesce(pr.display_name, 'Unknown member'), r.status, r.created_at
  from public.support_reports r
  left join public.profiles pr on pr.id = r.reporter_id
  where r.status = 'open'
  order by r.created_at desc
  limit 100;
end;
$$;

create function public.admin_resolve_support_report(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin_only' using errcode = '42501';
  end if;
  update public.support_reports set status = 'resolved' where id = p_report_id;
end;
$$;

revoke all on function public.submit_report(text, text, text, text) from public;
revoke all on function public.admin_get_support_reports() from public;
revoke all on function public.admin_resolve_support_report(uuid) from public;
grant execute on function public.submit_report(text, text, text, text) to authenticated;
grant execute on function public.admin_get_support_reports() to authenticated;
grant execute on function public.admin_resolve_support_report(uuid) to authenticated;
