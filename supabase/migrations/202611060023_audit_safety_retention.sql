begin;

-- A small time index makes the bounded retention cleanup cheap as the log grows.
create index if not exists audit_events_created_idx on public.audit_events(created_at);

-- Retention is applied on all audit writes and when an organizer opens the log.
-- This avoids relying on pg_cron being enabled in the Supabase project.
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

create or replace function public.record_audit_event(
  p_event_type text,
  p_hunt_id uuid default null,
  p_outcome text default 'notice',
  p_details jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
  v_operation_id text;
  v_stage text;
  v_app text;
begin
  if auth.uid() is null then raise exception 'Authenticated session required'; end if;
  if p_event_type is distinct from 'client_operation' then raise exception 'Only client operation reports are accepted'; end if;
  if p_outcome not in ('success','failure','notice') then raise exception 'Invalid audit outcome'; end if;
  if jsonb_typeof(v_details) is distinct from 'object' then raise exception 'Client audit details must be an object'; end if;
  if length(v_details::text) > 4000 then raise exception 'Audit details are too large'; end if;
  if v_details->>'client_report' is distinct from 'true' then raise exception 'Client report marker is required'; end if;
  if exists (
    select 1 from jsonb_object_keys(v_details) as supplied(key)
    where supplied.key not in ('client_report','operation_id','stage','app')
  ) then raise exception 'Unsupported client audit detail'; end if;

  v_operation_id := v_details->>'operation_id';
  v_stage := v_details->>'stage';
  v_app := v_details->>'app';
  if v_operation_id is null or v_operation_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'Invalid audit operation id';
  end if;
  if v_stage is null or length(v_stage) > 80 or v_stage !~ '^[a-z0-9_]+$' then raise exception 'Invalid audit stage'; end if;
  if v_app is null or v_app not in ('participant_web','organizer_web') then raise exception 'Invalid audit app'; end if;
  if p_hunt_id is not null and not (public.is_hunt_organizer(p_hunt_id) or public.is_hunt_participant(p_hunt_id)) then
    raise exception 'Audit access denied';
  end if;

  v_details := jsonb_build_object(
    'client_report', true,
    'operation_id', v_operation_id,
    'stage', v_stage,
    'app', v_app
  );
  insert into public.audit_events(actor_user_id,hunt_id,event_type,outcome,details)
  values(auth.uid(),p_hunt_id,'client_operation',p_outcome,v_details)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.record_audit_event(text,uuid,text,jsonb) from public, anon;
grant execute on function public.record_audit_event(text,uuid,text,jsonb) to authenticated;

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
