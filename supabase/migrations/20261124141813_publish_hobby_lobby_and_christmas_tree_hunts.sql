begin;

-- A starter is a staff-authored template, separate from any completed game.
alter table public.hunt_templates add column if not exists starter_key text;
alter table public.hunt_templates drop constraint if exists hunt_templates_starter_check;
alter table public.hunt_templates add constraint hunt_templates_starter_check
  check (starter_key is null or (visibility = 'public' and not is_completed_snapshot and completed_game_id is null));
create unique index if not exists hunt_templates_starter_key_uidx on public.hunt_templates(starter_key)
  where starter_key is not null;

create or replace function public.hunt_library_document(p_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', t.id, 'title', t.title, 'description', nullif(t.description, ''),
    'defaultDuration', t.default_duration_minutes, 'rules', t.rules, 'createdAt', t.created_at,
    'challenges', coalesce((
      select jsonb_agg(jsonb_build_object('title', i.title, 'description', nullif(i.description, ''),
        'points', i.points, 'displayOrder', i.display_order) order by i.display_order)
      from public.hunt_template_items i where i.template_id = t.id
    ), '[]'::jsonb)
  )
    || case when t.starter_key is null then '{}'::jsonb else '{"kind":"starter"}'::jsonb end
  from public.hunt_templates t
  where t.id = p_id and (t.is_completed_snapshot or t.starter_key is not null) and t.visibility = 'public';
$$;
revoke all on function public.hunt_library_document(uuid) from public, anon, authenticated;

create or replace function public.list_hunt_templates(p_owned boolean default false) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_owner uuid;
begin
  select id into v_owner from public.organizers where auth_user_id = auth.uid();
  if p_owned and v_owner is null then raise exception 'Organizer access required'; end if;
  if p_owned then
    return coalesce((select jsonb_agg(public.hunt_template_document(t.id) order by t.created_at desc, t.id)
      from public.hunt_templates t where t.organizer_id = v_owner), '[]'::jsonb);
  end if;
  return coalesce((select jsonb_agg(public.hunt_library_document(t.id) order by t.created_at desc, t.id)
    from public.hunt_templates t where (t.is_completed_snapshot or t.starter_key is not null) and t.visibility = 'public'), '[]'::jsonb);
end;
$$;
revoke all on function public.list_hunt_templates(boolean) from public;
grant execute on function public.list_hunt_templates(boolean) to anon, authenticated;

create or replace function public.guard_completed_hunt_library_snapshot() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('snapquest.library_snapshot_write', true), '') <> 'on' then
    if tg_table_name = 'hunt_templates' then
      if tg_op = 'UPDATE' and old.is_completed_snapshot and new.is_completed_snapshot
         and (to_jsonb(new) - array['organizer_id','creator_profile_id']) =
             (to_jsonb(old) - array['organizer_id','creator_profile_id'])
         and exists (
           select 1 from public.organizers o join public.hunt_creator_profiles c on c.organizer_id = o.id
           where o.is_system_profile and new.organizer_id = o.id and new.creator_profile_id = c.id
         ) then
        return new;
      end if;
      if tg_op = 'DELETE' and (old.is_completed_snapshot or old.starter_key is not null)
         and current_setting('snapquest.withdraw_hunt_template', true) = old.id::text then
        return old;
      end if;
      if (tg_op = 'INSERT' and (new.is_completed_snapshot or new.starter_key is not null))
         or (tg_op = 'UPDATE' and (old.is_completed_snapshot or new.is_completed_snapshot
              or old.starter_key is not null or new.starter_key is not null))
         or (tg_op = 'DELETE' and (old.is_completed_snapshot or old.starter_key is not null)) then
        raise exception 'Published Hunt Library snapshots are immutable';
      end if;
    elsif exists(select 1 from public.hunt_templates t
      where t.id in (new.template_id, old.template_id) and (t.is_completed_snapshot or t.starter_key is not null)) then
      raise exception 'Published Hunt Library challenges are immutable';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function public.guard_completed_hunt_library_snapshot() from public, anon, authenticated;

create or replace function public.copy_hunt_library_to_draft(p_template_id uuid, p_request_id uuid default gen_random_uuid()) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_template public.hunt_templates%rowtype; v_hunt_id uuid; v_request public.hunt_draft_requests%rowtype;
begin
  select id into v_owner from public.organizers where auth_user_id = auth.uid();
  if v_owner is null then raise exception 'Organizer access required'; end if;
  if p_request_id is null then raise exception 'A request ID is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_owner::text || ':' || p_request_id::text, 0));
  select * into v_request from public.hunt_draft_requests
    where organizer_id = v_owner and request_id = p_request_id;
  if found then
    if v_request.kind <> 'copy' or v_request.source_id is distinct from p_template_id then
      raise exception 'This request ID was already used for another hunt';
    end if;
    return v_request.draft_id;
  end if;
  select * into v_template from public.hunt_templates t
    where t.id = p_template_id and (t.is_completed_snapshot or t.starter_key is not null) and t.visibility = 'public' for share;
  if not found then raise exception 'Hunt not available'; end if;
  if not exists(select 1 from public.hunt_template_items where template_id = v_template.id) then raise exception 'Hunt has no challenges'; end if;
  insert into public.hunts(organizer_id, title, venue, description, rules, duration_minutes, template_id, template_snapshot)
  values(v_owner, v_template.title, 'Choose a venue', v_template.description, v_template.rules,
    v_template.default_duration_minutes, v_template.id, public.hunt_library_document(v_template.id)) returning id into v_hunt_id;
  insert into public.hunt_items(hunt_id, title_snapshot, description_snapshot, point_value, display_order)
  select v_hunt_id, title, nullif(description, ''), points, display_order
  from public.hunt_template_items where template_id = v_template.id order by display_order;
  insert into public.hunt_draft_requests(organizer_id, request_id, draft_id, kind, source_id)
    values(v_owner, p_request_id, v_hunt_id, 'copy', p_template_id);
  return v_hunt_id;
end;
$$;
revoke all on function public.copy_hunt_library_to_draft(uuid, uuid) from public;
grant execute on function public.copy_hunt_library_to_draft(uuid, uuid) to authenticated;

create or replace function public.copy_hunt_template(p_template_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_template public.hunt_templates%rowtype; v_owner uuid; v_id uuid;
begin
  select id into v_owner from public.organizers where auth_user_id = auth.uid();
  if v_owner is null then raise exception 'Organizer access required'; end if;
  select * into v_template from public.hunt_templates t where t.id = p_template_id and (
    ((t.is_completed_snapshot or t.starter_key is not null) and t.visibility = 'public') or (t.visibility = 'personal' and t.organizer_id = v_owner)
  ) for share;
  if not found then raise exception 'Hunt not available'; end if;
  v_id := public.save_hunt_template(v_template.title, v_template.venue, v_template.description, v_template.rules,
    (public.hunt_template_document(p_template_id))->'challenges', v_template.default_duration_minutes, 'personal', null);
  return v_id;
end;
$$;
revoke all on function public.copy_hunt_template(uuid) from public;
grant execute on function public.copy_hunt_template(uuid) to authenticated;

create or replace function public.create_game_from_template(p_template_id uuid, p_game_name text default null, p_duration integer default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_template public.hunt_templates%rowtype; v_id uuid;
begin
  select id into v_owner from public.organizers where auth_user_id = auth.uid();
  if v_owner is null then raise exception 'Organizer access required'; end if;
  select * into v_template from public.hunt_templates t where t.id = p_template_id and (
    ((t.is_completed_snapshot or t.starter_key is not null) and t.visibility = 'public') or (t.visibility = 'personal' and t.organizer_id = v_owner)
  ) for share;
  if not found then raise exception 'Hunt not available'; end if;
  if not exists(select 1 from public.hunt_template_items where template_id = p_template_id) then raise exception 'Hunt has no challenges'; end if;
  if p_duration is not null and p_duration < 1 then raise exception 'Duration must be a positive whole number of minutes'; end if;
  insert into public.hunts(organizer_id, title, venue, description, rules, duration_minutes, template_id, template_snapshot)
  values(v_owner, coalesce(nullif(trim(p_game_name), ''), v_template.title), v_template.venue, v_template.description, v_template.rules,
    coalesce(p_duration, v_template.default_duration_minutes), v_template.id, public.hunt_template_document(v_template.id)) returning id into v_id;
  insert into public.hunt_items(hunt_id, title_snapshot, description_snapshot, point_value, display_order)
  select v_id, title, nullif(description, ''), points, display_order from public.hunt_template_items where template_id = p_template_id;
  return v_id;
end;
$$;
revoke all on function public.create_game_from_template(uuid, text, integer) from public;
grant execute on function public.create_game_from_template(uuid, text, integer) to authenticated;

-- Publish one reviewed historical game and one original starter. Both are
-- independent reusable records. No game state or player records are copied.
do $$
declare
  v_community uuid;
  v_creator uuid;
  v_hobby public.hunts%rowtype;
  v_template uuid;
begin
  select o.id, c.id into strict v_community, v_creator
    from public.organizers o join public.hunt_creator_profiles c on c.organizer_id = o.id
    where o.is_system_profile;

  perform set_config('snapquest.library_snapshot_write', 'on', true);
  select * into v_hobby from public.hunts
    where id = '1377ab60-c54c-4a0a-9802-216f4060e9bd'
      and title = 'Hobby Lobby Scavenger Hunt'
      and status = 'completed'
      and jsonb_array_length(final_scores) > 0;
  if found then
    if (select count(*) from public.hunt_items where hunt_id = v_hobby.id) <> 49 then
      raise exception 'The reviewed Hobby Lobby game must contain 49 challenges';
    end if;
    insert into public.hunt_templates (
      organizer_id, creator_profile_id, title, venue, description, rules,
      default_duration_minutes, visibility, completed_game_id, is_completed_snapshot
    ) values (
      v_community, v_creator, v_hobby.title, 'Hobby Lobby',
      'The original 49-challenge craft store hunt, including quirky finds, seasonal displays, and team photos. Ask store staff before playing or taking photos.',
      v_hobby.rules, v_hobby.duration_minutes, 'public', v_hobby.id, true
    )
    on conflict (completed_game_id) where completed_game_id is not null do nothing
    returning id into v_template;
    if v_template is not null then
      insert into public.hunt_template_items(template_id, display_order, title, description, points)
      select v_template, display_order, title_snapshot, coalesce(description_snapshot, ''), point_value
      from public.hunt_items where hunt_id = v_hobby.id order by display_order;
    end if;
  end if;

  insert into public.hunt_templates (
    organizer_id, creator_profile_id, title, venue, description, rules,
    default_duration_minutes, visibility, starter_key
  ) values (
    v_community, v_creator, 'Christmas Tree Hunt', 'Choose a venue',
    'Follow a Christmas lights trail from tiny tabletop trees to oversized ornaments. Look for festive displays, stage a holiday movie scene, and finish with a greeting card photo.',
    array[
      'Play at a permitted public Christmas display, market, shopping center, or on public sidewalks. Ask venue staff before taking photos indoors.',
      'Walk together. Stay out of roads, driveways, and private property. Skip a clue whenever reaching it would be unsafe.',
      'Photograph displays from where you are allowed to stand. Leave decorations, ornaments, and gifts in place.',
      'Keep bystanders, faces you do not have permission to photograph, addresses, and license plates out of the frame.',
      'Submit one photo per challenge. Alternate clues count when listed. Agree on any venue-specific substitutions before you start.'
    ], 60, 'public', 'christmas-tree'
  ) on conflict (starter_key) where starter_key is not null do nothing returning id into v_template;

  if v_template is not null then
    insert into public.hunt_template_items(template_id, display_order, title, description, points)
    select v_template, item.display_order, item.title, item.description, item.points
    from (values
      (0, 'Find the star', 'Photograph a star, angel, bow, or oversized ornament that crowns a tree.', 1),
      (1, 'A tree dressed in red', 'Find a tree where red takes center stage, from cranberry ribbons to bright baubles.', 1),
      (2, 'Little tree, big personality', 'Find a tabletop or miniature tree with one detail that makes it memorable.', 1),
      (3, 'Winter white', 'Capture a tree with snow-white branches, frosted tips, or a snowflake decoration.', 1),
      (4, 'The first gift', 'Find a wrapped box or a display gift tucked under a tree. Leave it in place.', 1),
      (5, 'The candy-cane clue', 'Spot a candy cane, peppermint swirl, or red-and-white striped ornament.', 1),
      (6, 'A ribbon that steals the show', 'Find a bow, ribbon trail, or unusual garland. Frame it so the pattern is easy to see.', 1),
      (7, 'The tree''s favorite animal', 'Find an animal ornament or an animal display beside a tree.', 1),
      (8, 'Light in the window', 'Capture warm Christmas lights reflected in public glass or glowing in a public display.', 1),
      (9, 'A house with only blue lights', 'Find a house or display decorated entirely in blue Christmas lights. Stay on public paths and leave house numbers out of the frame.', 2),
      (10, 'Santa takes flight', 'Find Santa in an airplane. A plane ornament or toy next to a Santa decoration counts as a backup.', 3),
      (11, 'Throwback ornament', 'Find something that looks handmade, vintage, or like it has a story. Capture the detail that gives it away.', 2),
      (12, 'Two trees, two moods', 'Fit two trees with noticeably different colors or themes into one photo.', 2),
      (13, 'An unexpected tree', 'Find a tree made of something besides branches, such as books, lights, stacked gifts, or wood.', 2),
      (14, 'Christmas by the letter', 'Find a letter ornament or a sign with the first letter of your team name.', 2),
      (15, 'A tree with a theme', 'Find at least three decorations that go together, such as gingerbread, woodland animals, or music.', 2),
      (16, 'Ornament mirror shot', 'Capture your team or a second decoration reflected in a shiny ornament or a nearby mirror. Keep other people out of the frame.', 2),
      (17, 'Three generations of sparkle', 'Frame a small decoration, a medium decoration, and a big decoration in one photo.', 2),
      (18, 'The hidden guest', 'Find a tiny elf, mouse, bird, or other character tucked into a tree or a holiday display.', 2),
      (19, 'A rainbow of ornaments', 'Fit five different ornament colors into a single frame. Colorful lights count when ornaments are scarce.', 3),
      (20, 'The forest perspective', 'From a clear spot, photograph a tree so its lights lead your eye toward the top. Keep both feet on the ground.', 2),
      (21, 'The greeting card shot', 'Frame a tree, festive sign, and one consenting teammate as if they belong on the front of a holiday card.', 3),
      (22, 'The holiday movie scene', 'Create a still from an imaginary holiday movie using a tree and two consenting teammates. Pose without blocking an aisle or path.', 3),
      (23, 'The grand finale', 'Make one photo with a tree, an ornament or ribbon, and a consenting teammate pointing to their favorite detail.', 3)
    ) as item(display_order, title, description, points);
  end if;
  perform set_config('snapquest.library_snapshot_write', 'off', true);
end;
$$;

commit;
