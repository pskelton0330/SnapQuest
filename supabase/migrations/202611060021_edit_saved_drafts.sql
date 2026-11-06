begin;

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
  select * into v_hunt from public.hunts where id=p_hunt_id for update;
  if not found then raise exception 'Draft hunt not found'; end if;
  select id into v_organizer_id from public.organizers where auth_user_id=auth.uid() and id=v_hunt.organizer_id;
  if v_organizer_id is null then raise exception 'Organizer access required'; end if;
  if v_hunt.status <> 'draft' then raise exception 'Only an unpublished draft can be edited'; end if;
  if char_length(trim(coalesce(p_title,''))) not between 1 and 120 then raise exception 'Enter a hunt title (up to 120 characters)'; end if;
  if char_length(trim(coalesce(p_venue,''))) not between 1 and 160 then raise exception 'Enter a venue name (up to 160 characters)'; end if;
  if p_duration_minutes not between 5 and 1440 then raise exception 'Duration must be between 5 minutes and 24 hours'; end if;
  if coalesce(jsonb_typeof(p_items),'null') <> 'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Add between 1 and 100 photo challenges'; end if;

  delete from public.hunt_items where hunt_id=p_hunt_id;
  update public.hunts set title=trim(p_title),venue=trim(p_venue),rules=coalesce(p_rules,'{}'),duration_minutes=p_duration_minutes where id=p_hunt_id;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_item_title:=trim(coalesce(v_item->>'title',''));
    v_description:=nullif(trim(coalesce(v_item->>'description','')),'');
    v_points:=coalesce(nullif(v_item->>'pointValue','')::integer,1);
    if char_length(v_item_title) not between 1 and 120 then raise exception 'Each challenge needs a name (up to 120 characters)'; end if;
    if v_points not between 0 and 1000 then raise exception 'Point values must be between 0 and 1000'; end if;
    if nullif(v_item->>'libraryItemId','') is null then
      insert into public.library_items(organizer_id,title,description) values(v_organizer_id,v_item_title,v_description) returning id into v_library_id;
    else
      v_library_id:=(v_item->>'libraryItemId')::uuid;
      if not exists(select 1 from public.library_items where id=v_library_id and organizer_id=v_organizer_id and not archived) then raise exception 'A selected library challenge is no longer available'; end if;
    end if;
    insert into public.hunt_items(hunt_id,library_item_id,title_snapshot,description_snapshot,point_value,display_order)
      values(p_hunt_id,v_library_id,v_item_title,v_description,v_points,v_order);
    v_order:=v_order+1;
  end loop;
end;
$$;
revoke all on function public.update_hunt_draft(uuid,text,text,text[],jsonb,integer) from public;
grant execute on function public.update_hunt_draft(uuid,text,text,text[],jsonb,integer) to authenticated;

commit;
