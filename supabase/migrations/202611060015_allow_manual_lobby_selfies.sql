-- Manual-start hunts have no start_at while they are waiting in the lobby.
-- Team identity changes are still closed as soon as the organizer starts the hunt.
begin;

create or replace function public.set_team_name(p_hunt_id uuid, p_team_id uuid, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_hunt public.hunts%rowtype; v_name text := trim(coalesce(p_name, ''));
begin
  if auth.uid() is null or not (public.is_hunt_organizer(p_hunt_id) or public.is_hunt_team_member(p_hunt_id, p_team_id)) then
    raise exception 'Team access required';
  end if;
  if char_length(v_name) not between 1 and 40 then raise exception 'Team names must contain 1 to 40 characters'; end if;
  select * into v_hunt from public.hunts where id=p_hunt_id for update;
  if v_hunt.status <> 'scheduled' or (v_hunt.start_at is not null and v_hunt.start_at <= clock_timestamp()) then
    raise exception 'Team names can only change before the hunt starts';
  end if;
  if not exists (select 1 from public.teams where id=p_team_id and hunt_id=p_hunt_id) then raise exception 'Team not found'; end if;
  if exists (select 1 from public.teams where hunt_id=p_hunt_id and id<>p_team_id and lower(trim(name))=lower(v_name)) then
    raise exception 'That team name is already in use';
  end if;
  update public.teams set name=v_name where id=p_team_id and hunt_id=p_hunt_id;
end;
$$;

create or replace function public.can_submit_team_selfie(p_path text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_hunt_id uuid; v_team_id uuid; v_participant public.participants%rowtype; v_hunt public.hunts%rowtype;
begin
  if auth.uid() is null or array_length(string_to_array(p_path, '/'), 1) <> 4
     or split_part(p_path, '/', 3) <> 'selfie'
     or split_part(p_path, '/', 4) !~ '^[0-9a-fA-F-]{36}\.jpg$' then return false; end if;
  v_hunt_id := split_part(p_path, '/', 1)::uuid; v_team_id := split_part(p_path, '/', 2)::uuid;
  select * into v_participant from public.participants where hunt_id=v_hunt_id and team_id=v_team_id and auth_user_id=auth.uid();
  if not found then return false; end if;
  select * into v_hunt from public.hunts where id=v_hunt_id;
  return v_hunt.status='scheduled' and (v_hunt.start_at is null or clock_timestamp() < v_hunt.start_at);
exception when invalid_text_representation then return false;
end;
$$;

create or replace function public.submit_team_selfie(p_hunt_id uuid, p_team_id uuid, p_storage_path text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hunt public.hunts%rowtype; v_old_path text; v_participant public.participants%rowtype; v_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null or not public.is_hunt_team_member(p_hunt_id,p_team_id) then raise exception 'Team member access required'; end if;
  if array_length(string_to_array(p_storage_path,'/'),1) <> 4 or split_part(p_storage_path,'/',1)::uuid<>p_hunt_id
     or split_part(p_storage_path,'/',2)::uuid<>p_team_id or split_part(p_storage_path,'/',3)<>'selfie'
     or split_part(p_storage_path,'/',4) !~ '^[0-9a-fA-F-]{36}\.jpg$' then raise exception 'The team selfie reference is invalid'; end if;
  select * into v_hunt from public.hunts where id=p_hunt_id for update;
  if v_hunt.status<>'scheduled' or (v_hunt.start_at is not null and v_now>=v_hunt.start_at) then raise exception 'Team selfies close when the hunt starts'; end if;
  select * into v_participant from public.participants where hunt_id=p_hunt_id and team_id=p_team_id and auth_user_id=auth.uid();
  if not found then raise exception 'Team member access required'; end if;
  if not exists(select 1 from storage.objects where bucket_id='hunt-photos' and name=p_storage_path) then raise exception 'The uploaded team selfie was not found'; end if;
  select storage_path into v_old_path from public.team_selfies where hunt_id=p_hunt_id and team_id=p_team_id for update;
  insert into public.team_selfies(hunt_id,team_id,submitted_by,storage_path,submitted_at,updated_at)
  values(p_hunt_id,p_team_id,v_participant.id,p_storage_path,v_now,v_now)
  on conflict(hunt_id,team_id) do update set submitted_by=excluded.submitted_by,storage_path=excluded.storage_path,submitted_at=excluded.submitted_at,updated_at=excluded.updated_at;
  return jsonb_build_object('accepted',true,'submitted_at',v_now,'previous_storage_path',v_old_path,'submitted_by',v_participant.id);
exception when invalid_text_representation then raise exception 'The team selfie reference is invalid';
end;
$$;

commit;
