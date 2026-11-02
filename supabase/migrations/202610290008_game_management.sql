-- v1.2 Phase 4: organizer-only configuration and authoritative timing.
begin;
create or replace function public.configure_game(
  p_game_id uuid,p_name text,p_duration integer,p_team_names text[],p_assignment_mode text,
  p_start_at timestamptz default null,p_start_now boolean default false,
  p_voting_enabled boolean default false,p_bonus integer default 0
) returns table(team_id uuid,team_name text,invite_token text)
language plpgsql security definer set search_path='' as $$
declare v_game public.hunts%rowtype; v_start timestamptz;
begin
  if auth.uid() is null or not public.is_hunt_organizer(p_game_id) then raise exception 'Organizer access required'; end if;
  select * into v_game from public.hunts where id=p_game_id for update;
  if v_game.status<>'draft' then raise exception 'Only a setup draft can be configured'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 120 or p_duration is null or p_duration not between 5 and 1440 then raise exception 'Invalid game name or duration'; end if;
  if exists(select 1 from unnest(p_team_names) n where n is null) then raise exception 'Team names cannot be empty'; end if;
  v_start:=case when coalesce(p_start_now,false) then clock_timestamp() else p_start_at end;
  if v_start is null or (not coalesce(p_start_now,false) and v_start<=clock_timestamp()) then raise exception 'Choose a start time in the future'; end if;
  update public.hunts set title=trim(p_name),duration_minutes=p_duration where id=p_game_id;
  return query select p.team_id,p.team_name,p.invite_token from public.publish_hunt(p_game_id,p_team_names,p_assignment_mode,v_start,p_voting_enabled,p_bonus) p;
  if coalesce(p_start_now,false) then update public.hunts set status='active' where id=p_game_id; end if;
end $$;
revoke all on function public.configure_game(uuid,text,integer,text[],text,timestamptz,boolean,boolean,integer) from public;
grant execute on function public.configure_game(uuid,text,integer,text[],text,timestamptz,boolean,boolean,integer) to authenticated;

create or replace function public.start_game_now(p_game_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v_game public.hunts%rowtype; v_now timestamptz;
begin
  if auth.uid() is null or not public.is_hunt_organizer(p_game_id) then raise exception 'Organizer access required'; end if;
  select * into v_game from public.hunts where id=p_game_id for update;
  v_now:=clock_timestamp();
  if v_game.status<>'scheduled' or v_game.ended_at is not null or v_game.start_at is null or v_game.start_at<=v_now then raise exception 'Only an unstarted scheduled game can start now'; end if;
  update public.hunts set start_at=v_now,status='active' where id=p_game_id;
end $$;
revoke all on function public.start_game_now(uuid) from public;
grant execute on function public.start_game_now(uuid) to authenticated;

create or replace function public.reschedule_game(p_game_id uuid,p_start_at timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare v_game public.hunts%rowtype; v_now timestamptz;
begin
  if auth.uid() is null or not public.is_hunt_organizer(p_game_id) then raise exception 'Organizer access required'; end if;
  select * into v_game from public.hunts where id=p_game_id for update;
  v_now:=clock_timestamp();
  if v_game.status<>'scheduled' or v_game.ended_at is not null or v_game.start_at is null or v_game.start_at<=v_now then raise exception 'Only an unstarted game can be rescheduled'; end if;
  if p_start_at is null or p_start_at<=v_now then raise exception 'Choose a start time in the future'; end if;
  update public.hunts set start_at=p_start_at where id=p_game_id;
end $$;
revoke all on function public.reschedule_game(uuid,timestamptz) from public;
grant execute on function public.reschedule_game(uuid,timestamptz) to authenticated;

create or replace function public.add_game_time(p_game_id uuid,p_minutes integer) returns void
language plpgsql security definer set search_path='' as $$
declare v_game public.hunts%rowtype; v_now timestamptz;
begin
  if auth.uid() is null or not public.is_hunt_organizer(p_game_id) then raise exception 'Organizer access required'; end if;
  select * into v_game from public.hunts where id=p_game_id for update;
  v_now:=clock_timestamp();
  if v_game.status not in ('scheduled','active') or v_game.ended_at is not null or v_game.start_at is null
    or v_now<v_game.start_at or v_now>=v_game.start_at+make_interval(mins=>v_game.duration_minutes) then raise exception 'Only an active game can be extended'; end if;
  if p_minutes is null or p_minutes not between 1 and 120 or v_game.duration_minutes+p_minutes>1440 then raise exception 'Add 1 to 120 minutes up to a total of 24 hours'; end if;
  update public.hunts set duration_minutes=duration_minutes+p_minutes where id=p_game_id;
end $$;
revoke all on function public.add_game_time(uuid,integer) from public;
grant execute on function public.add_game_time(uuid,integer) to authenticated;

create or replace function public.get_game_lobby(p_game_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_game public.hunts%rowtype; v_now timestamptz:=clock_timestamp();
begin
  if auth.uid() is null or not public.is_hunt_organizer(p_game_id) then raise exception 'Organizer access required'; end if;
  select * into v_game from public.hunts where id=p_game_id;
  return jsonb_build_object('game_id',v_game.id,'name',v_game.title,'hunt_title',v_game.template_snapshot->>'title',
    'server_now',v_now,'start_at',v_game.start_at,'ends_at',coalesce(v_game.ended_at,v_game.start_at+make_interval(mins=>v_game.duration_minutes)),
    'runtime_state',case when v_game.status in ('draft','review','completed','archived') then v_game.status when v_game.ended_at is not null or v_now>=v_game.start_at+make_interval(mins=>v_game.duration_minutes) then 'ended' when v_now>=v_game.start_at then 'active' else 'scheduled' end,
    'teams',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'color',t.display_color) order by t.display_order) from public.teams t where t.hunt_id=p_game_id),'[]'::jsonb),
    'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name,'teamId',p.team_id) order by p.joined_at) from public.participants p where p.hunt_id=p_game_id),'[]'::jsonb));
end $$;
revoke all on function public.get_game_lobby(uuid) from public;
grant execute on function public.get_game_lobby(uuid) to authenticated;

-- Existing invoker draft creation becomes a checked RPC before raw writes are removed.
alter function public.create_hunt_draft(text,text,text[],jsonb,integer) security definer;
alter function public.create_hunt_draft(text,text,text[],jsonb,integer) set search_path='';
revoke insert,update,delete on public.hunts,public.hunt_items from authenticated;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='hunts') then
    alter publication supabase_realtime add table public.hunts;
  end if;
end $$;
-- Preserve upload validation and replacement behavior; refresh the deadline clock after locking.
create or replace function public.submit_hunt_photo(p_hunt_item_id uuid, p_storage_path text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_participant public.participants%rowtype;
  v_hunt public.hunts%rowtype;
  v_item public.hunt_items%rowtype;
  v_old_path text;
  v_now timestamptz;
begin
  if auth.uid() is null then raise exception 'A participant session is required'; end if;
  if array_length(string_to_array(p_storage_path, '/'), 1) <> 4
     or split_part(p_storage_path, '/', 4) !~ '^[0-9a-fA-F-]{36}\.jpg$' then
    raise exception 'The uploaded photo reference is invalid';
  end if;
  select * into v_item from public.hunt_items i where i.id = p_hunt_item_id;
  if not found then raise exception 'This photo challenge is not available'; end if;
  select * into v_participant from public.participants p
  where p.hunt_id = v_item.hunt_id and p.auth_user_id = auth.uid();
  if not found then raise exception 'You are not a participant in this hunt'; end if;
  if split_part(p_storage_path, '/', 1)::uuid <> v_item.hunt_id
     or split_part(p_storage_path, '/', 2)::uuid <> v_participant.team_id
     or split_part(p_storage_path, '/', 3)::uuid <> v_item.id then
    raise exception 'This photo does not belong to your team and challenge';
  end if;
  select * into v_hunt from public.hunts h where h.id = v_item.hunt_id for update;
  v_now := clock_timestamp(); -- Recheck time after acquiring the same game lock as timing controls.
  if v_hunt.status not in ('scheduled','active') or v_hunt.ended_at is not null
     or v_hunt.start_at is null or v_now < v_hunt.start_at
     or v_now >= v_hunt.start_at + make_interval(mins => v_hunt.duration_minutes) then
    raise exception 'The photo deadline has passed';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'hunt-photos' and o.name = p_storage_path) then
    raise exception 'The uploaded photo was not found';
  end if;

  select s.storage_path into v_old_path from public.submissions s
  where s.hunt_item_id = v_item.id and s.team_id = v_participant.team_id for update;
  if found then
    update public.submissions set participant_id = v_participant.id, storage_path = p_storage_path,
      submitted_at = v_now, approval_status = 'pending', reviewed_by = null, reviewed_at = null
    where hunt_item_id = v_item.id and team_id = v_participant.team_id;
  else
    insert into public.submissions(hunt_id, hunt_item_id, team_id, participant_id, storage_path, submitted_at)
    values (v_item.hunt_id, v_item.id, v_participant.team_id, v_participant.id, p_storage_path, v_now);
  end if;
  return jsonb_build_object('accepted', true, 'submitted_at', v_now, 'previous_storage_path', v_old_path);
end;
$$;

revoke all on function public.submit_hunt_photo(uuid, text) from public;
grant execute on function public.submit_hunt_photo(uuid, text) to authenticated;


commit;
