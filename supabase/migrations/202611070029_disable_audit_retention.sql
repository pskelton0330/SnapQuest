begin;

-- Preserve audit events beyond 365 days. Remove pruning installed by an earlier
-- draft of migration 025, if present, and restore the non-pruning log reader.
drop trigger if exists audit_events_retention on public.audit_events;
drop function if exists public.audit_events_retention_trigger();
drop function if exists public.prune_expired_audit_events();
drop index if exists public.audit_events_created_idx;

create or replace function public.list_hunt_audit_events(p_hunt_id uuid, p_limit integer default 100)
returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_hunt_organizer(p_hunt_id) then raise exception 'Organizer access required'; end if;
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

notify pgrst, 'reload schema';

commit;
