begin;

-- Refresh reporting retries reuse the operation ID and phase. Existing audit
-- events keep their original payloads and retention policy.
create unique index if not exists audit_events_refresh_episode_uidx
  on public.audit_events (actor_user_id, hunt_id, (details->>'operation_id'), (details->>'stage'))
  where event_type = 'client_operation' and details->>'stage' ~ '^(player_(context|challenges|submissions|progress|gallery)|chat)_refresh_(failed|recovered)$';

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
  v_refresh boolean;
  v_recovery_ms integer;
begin
  if auth.uid() is null then raise exception 'Authenticated session required'; end if;
  if p_event_type is distinct from 'client_operation' then raise exception 'Only client operation reports are accepted'; end if;
  if p_outcome is null or p_outcome not in ('success','failure','notice') then raise exception 'Invalid audit outcome'; end if;
  if jsonb_typeof(v_details) is distinct from 'object' then raise exception 'Client audit details must be an object'; end if;
  if length(v_details::text) > 4000 then raise exception 'Audit details are too large'; end if;
  if v_details->>'client_report' is distinct from 'true' then raise exception 'Client report marker is required'; end if;
  if exists (
    select 1 from jsonb_object_keys(v_details) as supplied(key)
    where supplied.key not in ('client_report','operation_id','stage','app','recovery_ms')
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

  v_refresh := v_stage ~ '^(player_(context|challenges|submissions|progress|gallery)|chat)_refresh_(failed|recovered)$';
  if v_refresh then
    if p_hunt_id is null or (v_stage like 'player_%' and v_app <> 'participant_web') then
      raise exception 'Invalid refresh audit scope';
    end if;
    if right(v_stage, 10) = '_recovered' then
      if p_outcome <> 'success'
         or jsonb_typeof(v_details->'recovery_ms') is distinct from 'number'
         or (v_details->>'recovery_ms') !~ '^(0|[1-9][0-9]{0,7})$' then
        raise exception 'Invalid refresh recovery duration';
      end if;
      v_recovery_ms := (v_details->>'recovery_ms')::integer;
      if v_recovery_ms > 86400000 then raise exception 'Invalid refresh recovery duration'; end if;
    elsif p_outcome <> 'failure' or v_details ? 'recovery_ms' then
      raise exception 'Invalid refresh failure report';
    end if;
  elsif v_details ? 'recovery_ms' then
    raise exception 'Unsupported client audit detail';
  end if;

  v_details := jsonb_build_object(
    'client_report', true,
    'operation_id', v_operation_id,
    'stage', v_stage,
    'app', v_app
  );
  if v_recovery_ms is not null then
    v_details := v_details || jsonb_build_object('recovery_ms', v_recovery_ms);
  end if;
  insert into public.audit_events(actor_user_id,hunt_id,event_type,outcome,details)
  values(auth.uid(),p_hunt_id,'client_operation',p_outcome,v_details)
  on conflict (actor_user_id, hunt_id, (details->>'operation_id'), (details->>'stage'))
    where event_type = 'client_operation'
      and details->>'stage' ~ '^(player_(context|challenges|submissions|progress|gallery)|chat)_refresh_(failed|recovered)$'
  do nothing
  returning id into v_id;
  if v_id is null and v_refresh then
    select a.id into v_id
    from public.audit_events a
    where a.event_type = 'client_operation'
      and a.details->>'stage' ~ '^(player_(context|challenges|submissions|progress|gallery)|chat)_refresh_(failed|recovered)$'
      and a.actor_user_id = auth.uid()
      and a.hunt_id = p_hunt_id
      and a.details->>'operation_id' = v_operation_id
      and a.details->>'stage' = v_stage;
  end if;
  return v_id;
end;
$$;

revoke all on function public.record_audit_event(text,uuid,text,jsonb) from public, anon;
grant execute on function public.record_audit_event(text,uuid,text,jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
