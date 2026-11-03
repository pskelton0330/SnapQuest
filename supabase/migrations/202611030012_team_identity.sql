-- Phase 2 field experience: team-selected names and one private pre-start selfie.
begin;

create table if not exists public.team_selfies (
  id uuid primary key default gen_random_uuid(),
  hunt_id uuid not null references public.hunts(id) on delete cascade,
  team_id uuid not null,
  submitted_by uuid not null,
  storage_path text not null unique,
  submitted_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (hunt_id, team_id) references public.teams(hunt_id, id) on delete cascade,
  foreign key (submitted_by, hunt_id, team_id) references public.participants(id, hunt_id, team_id) on delete cascade,
  unique (hunt_id, team_id)
);

create index if not exists team_selfies_hunt_idx on public.team_selfies(hunt_id, team_id);
alter table public.team_selfies enable row level security;

drop policy if exists "Organizers manage team selfies" on public.team_selfies;
drop policy if exists "Teams see their private selfie" on public.team_selfies;
create policy "Organizers manage team selfies" on public.team_selfies
  for all to authenticated using (public.is_hunt_organizer(hunt_id)) with check (public.is_hunt_organizer(hunt_id));
create policy "Teams see their private selfie" on public.team_selfies
  for select to authenticated using (public.is_hunt_team_member(hunt_id, team_id));

grant select on public.team_selfies to authenticated;
revoke insert, update, delete on public.team_selfies from authenticated;

create or replace function public.set_team_name(p_hunt_id uuid, p_team_id uuid, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_hunt public.hunts%rowtype; v_name text := trim(coalesce(p_name, ''));
begin
  if auth.uid() is null or not (public.is_hunt_organizer(p_hunt_id) or public.is_hunt_team_member(p_hunt_id, p_team_id)) then
    raise exception 'Team access required';
  end if;
  if char_length(v_name) not between 1 and 40 then raise exception 'Team names must contain 1 to 40 characters'; end if;
  select * into v_hunt from public.hunts where id=p_hunt_id for update;
  if v_hunt.status <> 'scheduled' or v_hunt.start_at is null or v_hunt.start_at <= clock_timestamp() then
    raise exception 'Team names can only change before the hunt starts';
  end if;
  if not exists (select 1 from public.teams where id=p_team_id and hunt_id=p_hunt_id) then raise exception 'Team not found'; end if;
  if exists (select 1 from public.teams where hunt_id=p_hunt_id and id<>p_team_id and lower(trim(name))=lower(v_name)) then
    raise exception 'That team name is already in use';
  end if;
  update public.teams set name=v_name where id=p_team_id and hunt_id=p_hunt_id;
end;
$$;
revoke all on function public.set_team_name(uuid,uuid,text) from public;
grant execute on function public.set_team_name(uuid,uuid,text) to authenticated;

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
  return v_hunt.status='scheduled' and v_hunt.start_at is not null and clock_timestamp() < v_hunt.start_at;
exception when invalid_text_representation then return false;
end;
$$;

create or replace function public.can_view_team_selfie(p_path text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_hunt_id uuid; v_team_id uuid;
begin
  if array_length(string_to_array(p_path, '/'), 1) <> 4 or split_part(p_path, '/', 3) <> 'selfie' then return false; end if;
  v_hunt_id := split_part(p_path, '/', 1)::uuid; v_team_id := split_part(p_path, '/', 2)::uuid;
  return public.is_hunt_organizer(v_hunt_id) or public.is_hunt_team_member(v_hunt_id, v_team_id);
exception when invalid_text_representation then return false;
end;
$$;

create or replace function public.can_delete_team_selfie(p_path text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  return public.can_view_team_selfie(p_path);
end;
$$;
revoke all on function public.can_submit_team_selfie(text), public.can_view_team_selfie(text), public.can_delete_team_selfie(text) from public;
grant execute on function public.can_submit_team_selfie(text), public.can_view_team_selfie(text), public.can_delete_team_selfie(text) to authenticated;

drop policy if exists "Team members upload team selfies" on storage.objects;
drop policy if exists "Authorized users view team selfies" on storage.objects;
drop policy if exists "Team members remove team selfies" on storage.objects;
create policy "Team members upload team selfies" on storage.objects for insert to authenticated
  with check (bucket_id='hunt-photos' and public.can_submit_team_selfie(name));
create policy "Authorized users view team selfies" on storage.objects for select to authenticated
  using (bucket_id='hunt-photos' and public.can_view_team_selfie(name));
create policy "Team members remove team selfies" on storage.objects for delete to authenticated
  using (bucket_id='hunt-photos' and public.can_delete_team_selfie(name));

create or replace function public.submit_team_selfie(p_hunt_id uuid, p_team_id uuid, p_storage_path text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hunt public.hunts%rowtype; v_old_path text; v_participant public.participants%rowtype; v_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null or not public.is_hunt_team_member(p_hunt_id,p_team_id) then raise exception 'Team member access required'; end if;
  if array_length(string_to_array(p_storage_path,'/'),1) <> 4 or split_part(p_storage_path,'/',1)::uuid<>p_hunt_id
     or split_part(p_storage_path,'/',2)::uuid<>p_team_id or split_part(p_storage_path,'/',3)<>'selfie'
     or split_part(p_storage_path,'/',4) !~ '^[0-9a-fA-F-]{36}\.jpg$' then raise exception 'The team selfie reference is invalid'; end if;
  select * into v_hunt from public.hunts where id=p_hunt_id for update;
  if v_hunt.status<>'scheduled' or v_hunt.start_at is null or v_now>=v_hunt.start_at then raise exception 'Team selfies close when the hunt starts'; end if;
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
revoke all on function public.submit_team_selfie(uuid,uuid,text) from public;
grant execute on function public.submit_team_selfie(uuid,uuid,text) to authenticated;

-- Extend the trusted participant context with only the current team's selfie metadata.
create or replace function public.get_participant_context(p_hunt_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_participant public.participants%rowtype; v_hunt public.hunts%rowtype; v_team public.teams%rowtype; v_selfie public.team_selfies%rowtype; v_now timestamptz:=clock_timestamp(); v_runtime text; v_teammates jsonb;
begin
  select * into v_participant from public.participants where hunt_id=p_hunt_id and auth_user_id=auth.uid();
  if not found then raise exception 'No participant session was found for this hunt'; end if;
  select * into v_hunt from public.hunts where id=p_hunt_id;
  select * into v_team from public.teams where id=v_participant.team_id;
  select * into v_selfie from public.team_selfies where hunt_id=p_hunt_id and team_id=v_participant.team_id;
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name) order by p.joined_at),'[]'::jsonb) into v_teammates from public.participants p where p.hunt_id=p_hunt_id and p.team_id=v_participant.team_id;
  if v_hunt.status='completed' then v_runtime:='completed'; elsif v_hunt.status='review' then v_runtime:='review'; elsif v_hunt.ended_at is not null or (v_hunt.start_at is not null and v_now>=v_hunt.start_at+make_interval(mins=>v_hunt.duration_minutes)) then v_runtime:='ended'; elsif v_hunt.start_at is null or v_hunt.start_at>v_now then v_runtime:='waiting'; else v_runtime:='active'; end if;
  return jsonb_build_object('participant_id',v_participant.id,'hunt_id',v_hunt.id,'title',v_hunt.title,'venue',v_hunt.venue,'rules',v_hunt.rules,'status',v_hunt.status,'runtime_state',v_runtime,'start_at',v_hunt.start_at,'duration_minutes',v_hunt.duration_minutes,'ends_at',case when v_hunt.ended_at is not null then v_hunt.ended_at else v_hunt.start_at+make_interval(mins=>v_hunt.duration_minutes) end,'server_now',v_now,'team',jsonb_build_object('id',v_team.id,'name',v_team.name,'display_color',v_team.display_color,'selfie',case when v_selfie.id is null then null else jsonb_build_object('storage_path',v_selfie.storage_path,'submitted_by',v_selfie.submitted_by,'submitted_at',v_selfie.submitted_at) end),'participant',jsonb_build_object('id',v_participant.id,'display_name',v_participant.display_name),'teammates',v_teammates);
end;
$$;
revoke all on function public.get_participant_context(uuid) from public;
grant execute on function public.get_participant_context(uuid) to authenticated;

commit;
