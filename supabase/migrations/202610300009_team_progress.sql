-- Phase 2: expose only aggregate accepted-slot progress to joined participants.
-- No photo paths, submitter identities, or challenge answers are returned.
create or replace function public.get_hunt_progress(p_hunt_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_total_items integer;
  v_progress jsonb;
begin
  if auth.uid() is null or not public.is_hunt_participant(p_hunt_id) then
    raise exception 'Participant access required';
  end if;

  select count(*)::integer into v_total_items
  from public.hunt_items
  where hunt_id = p_hunt_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'team_id', t.id,
    'team_name', t.name,
    'display_color', t.display_color,
    'accepted_count', coalesce(s.accepted_count, 0),
    'total_items', v_total_items
  ) order by t.display_order), '[]'::jsonb)
  into v_progress
  from public.teams t
  left join (
    select team_id, count(*)::integer as accepted_count
    from public.submissions
    where hunt_id = p_hunt_id
    group by team_id
  ) s on s.team_id = t.id
  where t.hunt_id = p_hunt_id;

  return v_progress;
end;
$$;

revoke all on function public.get_hunt_progress(uuid) from public;
grant execute on function public.get_hunt_progress(uuid) to authenticated;
