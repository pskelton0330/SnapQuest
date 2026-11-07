begin;

-- Explicit retention policy: this migration deletes diagnostic events older
-- than 365 days. Keep it separate from non-destructive audit hardening so it
-- can be reviewed and approved independently before production application.
create index if not exists audit_events_created_idx on public.audit_events(created_at);

create or replace function public.prune_expired_audit_events()
returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.audit_events
  where created_at < clock_timestamp() - interval '365 days';
end;
$$;
revoke all on function public.prune_expired_audit_events() from public, anon, authenticated;

create or replace function public.audit_events_retention_trigger()
returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.prune_expired_audit_events();
  return null;
end;
$$;
revoke all on function public.audit_events_retention_trigger() from public, anon, authenticated;

drop trigger if exists audit_events_retention on public.audit_events;
create trigger audit_events_retention
after insert on public.audit_events
for each statement execute function public.audit_events_retention_trigger();

create or replace function public.list_hunt_audit_events(p_hunt_id uuid, p_limit integer default 100)
returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_hunt_organizer(p_hunt_id) then raise exception 'Organizer access required'; end if;
  perform public.prune_expired_audit_events();
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',a.id,'created_at',a.created_at,'actor_user_id',a.actor_user_id,
    'event_type',a.event_type,'outcome',a.outcome,'details',a.details,
    'source',case when a.event_type = 'client_operation' then 'client-reported' else 'server-authoritative' end
  ) order by a.created_at desc) from (
    select * from public.audit_events
    where hunt_id=p_hunt_id
    order by created_at desc
    limit least(greatest(coalesce(p_limit,100),1),500)
  ) a),'[]'::jsonb);
end;
$$;

revoke all on function public.list_hunt_audit_events(uuid,integer) from public, anon;
grant execute on function public.list_hunt_audit_events(uuid,integer) to authenticated;

commit;
