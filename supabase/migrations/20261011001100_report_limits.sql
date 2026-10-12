-- Caps how many reports one member can file per day (polls and takes combined)
-- so the report buttons cannot be used to spam moderation or brigade content.

create or replace function public.enforce_report_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    (select count(*) from public.poll_reports r
      where r.reporter_id = new.reporter_id and r.created_at > now() - interval '24 hours')
    +
    (select count(*) from public.take_reports r
      where r.reporter_id = new.reporter_id and r.created_at > now() - interval '24 hours')
  ) >= 10 then
    raise exception 'report_limit_reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_report_limit() from public;

drop trigger if exists poll_reports_limit on public.poll_reports;
create trigger poll_reports_limit
before insert on public.poll_reports
for each row execute function public.enforce_report_limit();

drop trigger if exists take_reports_limit on public.take_reports;
create trigger take_reports_limit
before insert on public.take_reports
for each row execute function public.enforce_report_limit();
