-- Do not let the general post-hunt photo review policy widen access to
-- team-selfie objects, which have their own team-scoped Storage policy.
create or replace function public.can_view_hunt_photo(p_path text)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_hunt_id uuid;
  v_team_id uuid;
begin
  if array_length(string_to_array(p_path, '/'), 1) <> 4
     or split_part(p_path, '/', 3) = 'selfie' then
    return false;
  end if;
  v_hunt_id := split_part(p_path, '/', 1)::uuid;
  v_team_id := split_part(p_path, '/', 2)::uuid;
  return public.is_hunt_organizer(v_hunt_id)
    or public.is_hunt_team_member(v_hunt_id, v_team_id)
    or (
      public.is_hunt_participant(v_hunt_id)
      and exists (
        select 1 from public.hunts h where h.id = v_hunt_id
          and (h.status in ('review','completed') or h.ended_at is not null
            or clock_timestamp() >= h.start_at + make_interval(mins => h.duration_minutes))
      )
    );
exception when invalid_text_representation then return false;
end;
$$;
