-- Phase 2 operations: durable, privacy-safe audit events for troubleshooting.
begin;

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default clock_timestamp(),
  actor_user_id uuid references auth.users(id) on delete set null,
  hunt_id uuid references public.hunts(id) on delete set null,
  event_type text not null check (length(trim(event_type)) between 1 and 80),
  outcome text not null check (outcome in ('success','failure','notice')),
  details jsonb not null default '{}'::jsonb check (length(details::text) <= 4000)
);

create index if not exists audit_events_hunt_created_idx on public.audit_events(hunt_id, created_at desc);
create index if not exists audit_events_actor_created_idx on public.audit_events(actor_user_id, created_at desc);
alter table public.audit_events enable row level security;

drop policy if exists "Organizers read their hunt audit events" on public.audit_events;
create policy "Organizers read their hunt audit events" on public.audit_events
  for select to authenticated
  using (exists (
    select 1 from public.hunts h
    join public.organizers o on o.id = h.organizer_id
    where h.id = audit_events.hunt_id and o.auth_user_id = auth.uid()
  ));

revoke all on public.audit_events from public, anon, authenticated;
grant select on public.audit_events to authenticated;

create or replace function public.record_audit_event(
  p_event_type text,
  p_hunt_id uuid default null,
  p_outcome text default 'notice',
  p_details jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authenticated session required'; end if;
  if p_event_type is null or length(trim(p_event_type)) not between 1 and 80 then raise exception 'Invalid audit event type'; end if;
  if p_outcome not in ('success','failure','notice') then raise exception 'Invalid audit outcome'; end if;
  if length(coalesce(p_details, '{}'::jsonb)::text) > 4000 then raise exception 'Audit details are too large'; end if;
  if p_hunt_id is not null and not (public.is_hunt_organizer(p_hunt_id) or public.is_hunt_participant(p_hunt_id)) then
    raise exception 'Audit access denied';
  end if;
  insert into public.audit_events(actor_user_id,hunt_id,event_type,outcome,details)
  values(auth.uid(),p_hunt_id,trim(p_event_type),p_outcome,coalesce(p_details,'{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.record_audit_event(text,uuid,text,jsonb) from public;
grant execute on function public.record_audit_event(text,uuid,text,jsonb) to authenticated;

create or replace function public.list_hunt_audit_events(p_hunt_id uuid, p_limit integer default 100)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_hunt_organizer(p_hunt_id) then raise exception 'Organizer access required'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',a.id,'created_at',a.created_at,'actor_user_id',a.actor_user_id,
    'event_type',a.event_type,'outcome',a.outcome,'details',a.details
  ) order by a.created_at desc) from (
    select * from public.audit_events
    where hunt_id=p_hunt_id
    order by created_at desc
    limit least(greatest(coalesce(p_limit,100),1),500)
  ) a),'[]'::jsonb);
end;
$$;

revoke all on function public.list_hunt_audit_events(uuid,integer) from public;
grant execute on function public.list_hunt_audit_events(uuid,integer) to authenticated;

-- Replace the timing operation so successful starts are recorded server-side.
create or replace function public.start_game_now(p_game_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_game public.hunts%rowtype; v_now timestamptz;
begin
  if auth.uid() is null or not public.is_hunt_organizer(p_game_id) then raise exception 'Organizer access required'; end if;
  select * into v_game from public.hunts where id=p_game_id for update;
  v_now:=clock_timestamp();
  if v_game.status<>'scheduled' or v_game.ended_at is not null or v_game.start_at is null or v_game.start_at<=v_now then raise exception 'Only an unstarted scheduled game can start now'; end if;
  update public.hunts set start_at=v_now,status='active' where id=p_game_id;
  insert into public.audit_events(actor_user_id,hunt_id,event_type,outcome,details)
  values(auth.uid(),p_game_id,'game_start_now','success',jsonb_build_object('start_at',v_now,'previous_start_at',v_game.start_at,'duration_minutes',v_game.duration_minutes));
end;
$$;

revoke all on function public.start_game_now(uuid) from public;
grant execute on function public.start_game_now(uuid) to authenticated;

commit;
