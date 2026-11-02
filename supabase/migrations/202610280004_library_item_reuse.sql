-- Phase 2 completion: allow venue hunts to reference a reusable library item while
-- keeping per-hunt text and points in a separate immutable snapshot.
create or replace function public.create_hunt_draft(
  p_title text,
  p_venue text,
  p_rules text[],
  p_items jsonb,
  p_duration_minutes integer default 60
) returns uuid
language plpgsql
set search_path = public
as $$
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

  if v_organizer_id is null then
    raise exception 'Organizer profile required';
  end if;
  if char_length(trim(coalesce(p_venue, ''))) not between 1 and 160 then
    raise exception 'Enter a venue name (up to 160 characters)';
  end if;
  if char_length(trim(coalesce(p_title, ''))) not between 1 and 120 then
    raise exception 'Enter a hunt title (up to 120 characters)';
  end if;
  if coalesce(jsonb_typeof(p_items), 'null') <> 'array' then
    raise exception 'Add between 1 and 100 photo challenges';
  end if;
  if jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'Add between 1 and 100 photo challenges';
  end if;
  if p_duration_minutes not between 5 and 1440 then
    raise exception 'Duration must be between 5 minutes and 24 hours';
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
