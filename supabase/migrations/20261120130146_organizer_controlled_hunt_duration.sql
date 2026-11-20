begin;

-- Organizer-selected durations are stored as positive whole minutes. PostgreSQL
-- integer is the storage limit; there is no product-level 24-hour cap.
alter table public.hunts
  drop constraint if exists hunts_duration_minutes_check;
alter table public.hunts
  add constraint hunts_duration_minutes_positive_check check (duration_minutes >= 1);

alter table public.hunt_templates
  drop constraint if exists hunt_templates_default_duration_minutes_check;
alter table public.hunt_templates
  add constraint hunt_templates_duration_minutes_positive_check check (default_duration_minutes >= 1);

create or replace function public.create_hunt_draft(
  p_title text,
  p_venue text,
  p_rules text[],
  p_items jsonb,
  p_duration_minutes integer default 60
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_organizer_id uuid;
  v_hunt_id uuid;
  v_library_item_id uuid;
  v_item jsonb;
  v_title text;
  v_description text;
  v_point_value integer;
  v_order integer := 0;
begin
  select id into v_organizer_id
  from public.organizers
  where auth_user_id = auth.uid();

  if v_organizer_id is null then raise exception 'Organizer profile required'; end if;
  if char_length(trim(coalesce(p_venue, ''))) not between 1 and 160 then
    raise exception 'Enter a venue name (up to 160 characters)';
  end if;
  if char_length(trim(coalesce(p_title, ''))) not between 1 and 120 then
    raise exception 'Enter a hunt title (up to 120 characters)';
  end if;
  if cardinality(coalesce(p_rules, '{}')) > 30
     or exists(select 1 from unnest(coalesce(p_rules, '{}')) r where r is null or char_length(trim(r)) not between 1 and 1000) then
    raise exception 'Use up to 30 rules, each 1 to 1,000 characters';
  end if;
  if coalesce(jsonb_typeof(p_items), 'null') <> 'array' then
    raise exception 'Add between 1 and 100 photo challenges';
  end if;
  if jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'Add between 1 and 100 photo challenges';
  end if;
  if p_duration_minutes is null or p_duration_minutes < 1 then
    raise exception 'Duration must be a positive whole number of minutes';
  end if;

  insert into public.hunts(organizer_id, title, venue, rules, duration_minutes)
  values (v_organizer_id, trim(p_title), trim(p_venue), coalesce(p_rules, '{}'), p_duration_minutes)
  returning id into v_hunt_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_title := trim(coalesce(v_item->>'title', ''));
    v_description := nullif(trim(coalesce(v_item->>'description', '')), '');
    v_point_value := coalesce(nullif(v_item->>'pointValue', '')::integer, 1);
    if char_length(v_title) not between 1 and 120 then
      raise exception 'Each challenge needs a name (up to 120 characters)';
    end if;
    if v_point_value not between 0 and 1000 then
      raise exception 'Point values must be between 0 and 1000';
    end if;

    if nullif(v_item->>'libraryItemId', '') is null then
      insert into public.library_items(organizer_id, title, description)
      values (v_organizer_id, v_title, v_description)
      returning id into v_library_item_id;
    else
      v_library_item_id := (v_item->>'libraryItemId')::uuid;
      perform 1 from public.library_items li
      where li.id = v_library_item_id and li.organizer_id = v_organizer_id and not li.archived;
      if not found then raise exception 'A selected library challenge is no longer available'; end if;
    end if;

    insert into public.hunt_items(hunt_id, library_item_id, title_snapshot, description_snapshot, point_value, display_order)
    values (v_hunt_id, v_library_item_id, v_title, v_description, v_point_value, v_order);
    v_order := v_order + 1;
  end loop;

  return v_hunt_id;
end;
$$;
revoke all on function public.create_hunt_draft(text, text, text[], jsonb, integer) from public;
grant execute on function public.create_hunt_draft(text, text, text[], jsonb, integer) to authenticated;

create or replace function public.update_hunt_draft(
  p_hunt_id uuid,
  p_title text,
  p_venue text,
  p_rules text[],
  p_items jsonb,
  p_duration_minutes integer
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_hunt public.hunts%rowtype;
  v_organizer_id uuid;
  v_item jsonb;
  v_library_id uuid;
  v_item_title text;
  v_description text;
  v_points integer;
  v_order integer := 0;
begin
  if auth.uid() is null then raise exception 'Organizer access required'; end if;
  select * into v_hunt from public.hunts where id = p_hunt_id for update;
  if not found then raise exception 'Draft hunt not found'; end if;
  select id into v_organizer_id from public.organizers where auth_user_id = auth.uid() and id = v_hunt.organizer_id;
  if v_organizer_id is null then raise exception 'Organizer access required'; end if;
  if v_hunt.status <> 'draft' then raise exception 'Only an unpublished draft can be edited'; end if;
  if char_length(trim(coalesce(p_title, ''))) not between 1 and 120 then raise exception 'Enter a hunt title (up to 120 characters)'; end if;
  if char_length(trim(coalesce(p_venue, ''))) not between 1 and 160 then raise exception 'Enter a venue name (up to 160 characters)'; end if;
  if cardinality(coalesce(p_rules, '{}')) > 30
     or exists(select 1 from unnest(coalesce(p_rules, '{}')) r where r is null or char_length(trim(r)) not between 1 and 1000) then
    raise exception 'Use up to 30 rules, each 1 to 1,000 characters';
  end if;
  if p_duration_minutes is null or p_duration_minutes < 1 then raise exception 'Duration must be a positive whole number of minutes'; end if;
  if coalesce(jsonb_typeof(p_items), 'null') <> 'array' then raise exception 'Add between 1 and 100 photo challenges'; end if;
  if jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Add between 1 and 100 photo challenges'; end if;

  delete from public.hunt_items where hunt_id = p_hunt_id;
  update public.hunts set title = trim(p_title), venue = trim(p_venue), rules = coalesce(p_rules, '{}'), duration_minutes = p_duration_minutes where id = p_hunt_id;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_item_title := trim(coalesce(v_item->>'title', ''));
    v_description := nullif(trim(coalesce(v_item->>'description', '')), '');
    v_points := coalesce(nullif(v_item->>'pointValue', '')::integer, 1);
    if char_length(v_item_title) not between 1 and 120 then raise exception 'Each challenge needs a name (up to 120 characters)'; end if;
    if v_points not between 0 and 1000 then raise exception 'Point values must be between 0 and 1000'; end if;
    if nullif(v_item->>'libraryItemId', '') is null then
      insert into public.library_items(organizer_id, title, description) values(v_organizer_id, v_item_title, v_description) returning id into v_library_id;
    else
      v_library_id := (v_item->>'libraryItemId')::uuid;
      if not exists(select 1 from public.library_items where id = v_library_id and organizer_id = v_organizer_id and not archived) then raise exception 'A selected library challenge is no longer available'; end if;
    end if;
    insert into public.hunt_items(hunt_id, library_item_id, title_snapshot, description_snapshot, point_value, display_order)
      values(p_hunt_id, v_library_id, v_item_title, v_description, v_points, v_order);
    v_order := v_order + 1;
  end loop;
end;
$$;
revoke all on function public.update_hunt_draft(uuid, text, text, text[], jsonb, integer) from public;
grant execute on function public.update_hunt_draft(uuid, text, text, text[], jsonb, integer) to authenticated;

-- Keep live extensions usable after an organizer starts with a duration longer
-- than 24 hours, while guarding the database integer limit without overflow.
create or replace function public.add_game_time(p_game_id uuid, p_minutes integer) returns void
language plpgsql security definer set search_path = '' as $$
declare v_game public.hunts%rowtype; v_now timestamptz; v_duration integer;
begin
  if auth.uid() is null or not public.is_hunt_organizer(p_game_id) then raise exception 'Organizer access required'; end if;
  select * into v_game from public.hunts where id = p_game_id for update;
  v_now := clock_timestamp();
  if v_game.status not in ('scheduled', 'active') or v_game.ended_at is not null or v_game.start_at is null
    or v_now < v_game.start_at or v_now >= v_game.start_at + make_interval(mins => v_game.duration_minutes) then
    raise exception 'Only an active game can be extended';
  end if;
  if p_minutes is null or p_minutes not between 1 and 120 then raise exception 'Add 1 to 120 whole minutes'; end if;
  if p_minutes > 2147483647 - v_game.duration_minutes then raise exception 'This would exceed the maximum supported hunt duration'; end if;
  v_duration := v_game.duration_minutes + p_minutes;
  update public.hunts set duration_minutes = v_duration where id = p_game_id;
  insert into public.audit_events(actor_user_id, hunt_id, event_type, outcome, details)
  values(auth.uid(), p_game_id, 'game_time_added', 'success', jsonb_build_object('minutes_added', p_minutes, 'previous_duration_minutes', v_game.duration_minutes, 'duration_minutes', v_duration));
end;
$$;
revoke all on function public.add_game_time(uuid, integer) from public;
grant execute on function public.add_game_time(uuid, integer) to authenticated;

create or replace function public.configure_game(
  p_game_id uuid, p_name text, p_duration integer, p_team_names text[], p_assignment_mode text,
  p_start_at timestamptz default null, p_start_now boolean default false,
  p_voting_enabled boolean default false, p_bonus integer default 0
) returns table(team_id uuid, team_name text, invite_token text)
language plpgsql security definer set search_path = '' as $$
declare v_game public.hunts%rowtype; v_start timestamptz;
begin
  if auth.uid() is null or not public.is_hunt_organizer(p_game_id) then raise exception 'Organizer access required'; end if;
  select * into v_game from public.hunts where id = p_game_id for update;
  if v_game.status <> 'draft' then raise exception 'Only a setup draft can be configured'; end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 120 or p_duration is null or p_duration < 1 then
    raise exception 'Invalid game name or duration';
  end if;
  if exists(select 1 from unnest(p_team_names) n where n is null) then raise exception 'Team names cannot be empty'; end if;
  v_start := case when coalesce(p_start_now, false) then clock_timestamp() else p_start_at end;
  if not coalesce(p_start_now, false) and v_start is not null and v_start <= clock_timestamp() then raise exception 'Choose a start time in the future'; end if;
  update public.hunts set title = trim(p_name), duration_minutes = p_duration where id = p_game_id;
  return query select p.team_id, p.team_name, p.invite_token
    from public.publish_hunt(p_game_id, p_team_names, p_assignment_mode, v_start, p_voting_enabled, p_bonus) p;
  if coalesce(p_start_now, false) then update public.hunts set status = 'active' where id = p_game_id; end if;
end;
$$;
revoke all on function public.configure_game(uuid, text, integer, text[], text, timestamptz, boolean, boolean, integer) from public;
grant execute on function public.configure_game(uuid, text, integer, text[], text, timestamptz, boolean, boolean, integer) to authenticated;

commit;
