-- Phase 2 reliability: record authoritative game timing transitions.
begin;

create or replace function public.reschedule_game(p_game_id uuid,p_start_at timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare v_game public.hunts%rowtype; v_now timestamptz;
begin
  if auth.uid() is null or not public.is_hunt_organizer(p_game_id) then raise exception 'Organizer access required'; end if;
  select * into v_game from public.hunts where id=p_game_id for update;
  v_now:=clock_timestamp();
  if v_game.status<>'scheduled' or v_game.ended_at is not null or v_game.start_at is null or v_game.start_at<=v_now then raise exception 'Only an unstarted scheduled game can be rescheduled'; end if;
  if p_start_at is null or p_start_at<=v_now then raise exception 'Choose a start time in the future'; end if;
  update public.hunts set start_at=p_start_at where id=p_game_id;
  insert into public.audit_events(actor_user_id,hunt_id,event_type,outcome,details)
  values(auth.uid(),p_game_id,'game_reschedule','success',jsonb_build_object('previous_start_at',v_game.start_at,'start_at',p_start_at));
end $$;
revoke all on function public.reschedule_game(uuid,timestamptz) from public;
grant execute on function public.reschedule_game(uuid,timestamptz) to authenticated;

create or replace function public.add_game_time(p_game_id uuid,p_minutes integer) returns void
language plpgsql security definer set search_path='' as $$
declare v_game public.hunts%rowtype; v_now timestamptz; v_duration integer;
begin
  if auth.uid() is null or not public.is_hunt_organizer(p_game_id) then raise exception 'Organizer access required'; end if;
  select * into v_game from public.hunts where id=p_game_id for update;
  v_now:=clock_timestamp();
  if v_game.status not in ('scheduled','active') or v_game.ended_at is not null or v_game.start_at is null
    or v_now<v_game.start_at or v_now>=v_game.start_at+make_interval(mins=>v_game.duration_minutes) then raise exception 'Only an active game can be extended'; end if;
  if p_minutes is null or p_minutes not between 1 and 120 or v_game.duration_minutes+p_minutes>1440 then raise exception 'Add 1 to 120 minutes up to a total of 24 hours'; end if;
  v_duration:=v_game.duration_minutes+p_minutes;
  update public.hunts set duration_minutes=v_duration where id=p_game_id;
  insert into public.audit_events(actor_user_id,hunt_id,event_type,outcome,details)
  values(auth.uid(),p_game_id,'game_time_added','success',jsonb_build_object('minutes_added',p_minutes,'previous_duration_minutes',v_game.duration_minutes,'duration_minutes',v_duration));
end $$;
revoke all on function public.add_game_time(uuid,integer) from public;
grant execute on function public.add_game_time(uuid,integer) to authenticated;

create or replace function public.end_hunt_early(p_hunt_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_hunt public.hunts%rowtype; v_now timestamptz;
begin
  if auth.uid() is null or not public.is_hunt_organizer(p_hunt_id) then raise exception 'Organizer access required'; end if;
  select * into v_hunt from public.hunts where id=p_hunt_id for update;
  if v_hunt.status not in ('scheduled','active') or v_hunt.ended_at is not null then raise exception 'This hunt cannot be ended from its current state'; end if;
  v_now:=clock_timestamp();
  update public.hunts set status='review', ended_at=coalesce(ended_at,v_now) where id=p_hunt_id;
  insert into public.audit_events(actor_user_id,hunt_id,event_type,outcome,details)
  values(auth.uid(),p_hunt_id,'game_end_early','success',jsonb_build_object('previous_status',v_hunt.status,'ended_at',coalesce(v_hunt.ended_at,v_now)));
end;
$$;
revoke all on function public.end_hunt_early(uuid) from public;
grant execute on function public.end_hunt_early(uuid) to authenticated;

create or replace function public.begin_hunt_review(p_hunt_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_hunt public.hunts%rowtype; v_now timestamptz;
begin
  if auth.uid() is null or not public.is_hunt_organizer(p_hunt_id) then raise exception 'Organizer access required'; end if;
  select * into v_hunt from public.hunts where id=p_hunt_id for update;
  v_now:=clock_timestamp();
  if v_hunt.status not in ('scheduled','active') then raise exception 'This hunt is not ready for review'; end if;
  if v_hunt.ended_at is null and (v_hunt.start_at is null or v_now < v_hunt.start_at + make_interval(mins => v_hunt.duration_minutes)) then
    raise exception 'You can review photos after the hunt ends';
  end if;
  update public.hunts set status='review', ended_at=coalesce(ended_at,v_now) where id=p_hunt_id;
  insert into public.audit_events(actor_user_id,hunt_id,event_type,outcome,details)
  values(auth.uid(),p_hunt_id,'game_review_started','success',jsonb_build_object('previous_status',v_hunt.status,'ended_at',coalesce(v_hunt.ended_at,v_now)));
end;
$$;
revoke all on function public.begin_hunt_review(uuid) from public;
grant execute on function public.begin_hunt_review(uuid) to authenticated;

commit;
