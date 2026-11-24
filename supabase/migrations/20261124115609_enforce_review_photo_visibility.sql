begin;

-- Other teams see current approved submissions only, once the game ends.
-- Organizer and own-team access support review, uploads, and replacement.
create or replace function public.can_view_hunt_photo(p_path text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_hunt_id uuid;
  v_team_id uuid;
begin
  if auth.uid() is null or p_path is null
     or array_length(string_to_array(p_path, '/'), 1) <> 4
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
        select 1
        from public.submissions s
        join public.hunts h on h.id = s.hunt_id
        where s.storage_path = p_path and s.hunt_id = v_hunt_id and s.team_id = v_team_id
          and s.approval_status = 'approved'
          and (h.status in ('review','completed') or h.ended_at is not null
            or clock_timestamp() >= h.start_at + make_interval(mins => h.duration_minutes))
      )
    );
exception when invalid_text_representation then return false;
end;
$$;
revoke all on function public.can_view_hunt_photo(text) from public, anon;
grant execute on function public.can_view_hunt_photo(text) to authenticated;

drop policy if exists "Authorized users see submissions" on public.submissions;
create policy "Authorized users see submissions" on public.submissions
  for select to authenticated using (
    public.is_hunt_organizer(hunt_id)
    or public.is_hunt_team_member(hunt_id, team_id)
    or (
      approval_status = 'approved' and public.is_hunt_participant(hunt_id)
      and exists (
        select 1 from public.hunts h where h.id = hunt_id
          and (h.status in ('review','completed') or h.ended_at is not null
            or clock_timestamp() >= h.start_at + make_interval(mins => h.duration_minutes))
      )
    )
  );

create or replace function public.get_hunt_review_gallery(p_hunt_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_hunt public.hunts%rowtype;
  v_data jsonb;
  v_organizer boolean;
  v_team_id uuid;
begin
  select * into v_hunt from public.hunts h where h.id = p_hunt_id;
  if not found then raise exception 'Hunt access required'; end if;
  v_organizer := public.is_hunt_organizer(p_hunt_id);
  select p.team_id into v_team_id from public.participants p
  where p.hunt_id = p_hunt_id and p.auth_user_id = auth.uid();
  if not v_organizer and v_team_id is null then
    raise exception 'Hunt access required';
  end if;
  if v_hunt.status not in ('review','completed')
     and v_hunt.ended_at is null
     and (v_hunt.start_at is null or clock_timestamp() < v_hunt.start_at + make_interval(mins => v_hunt.duration_minutes)) then
    raise exception 'The gallery opens after the hunt ends';
  end if;
  select jsonb_build_object(
    'voting_enabled', v_hunt.voting_enabled,
    'voting_bonus_points', v_hunt.voting_bonus_points,
    'status', v_hunt.status,
    'can_begin_review', v_hunt.status in ('scheduled','active') and (v_hunt.ended_at is not null or (v_hunt.start_at is not null and clock_timestamp() >= v_hunt.start_at + make_interval(mins => v_hunt.duration_minutes))),
    'final_scores', v_hunt.final_scores,
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'display_color',t.display_color) order by t.display_order) from public.teams t where t.hunt_id=p_hunt_id),'[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'title',i.title_snapshot,'points',i.point_value,'display_order',i.display_order) order by i.display_order) from public.hunt_items i where i.hunt_id=p_hunt_id),'[]'::jsonb),
    'submissions', coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'item_id',s.hunt_item_id,'team_id',s.team_id,'participant_id',s.participant_id,'storage_path',s.storage_path,'status',s.approval_status,'submitted_at',s.submitted_at)) from public.submissions s where s.hunt_id=p_hunt_id
      and (v_organizer or s.team_id = v_team_id or s.approval_status = 'approved')),'[]'::jsonb),
    'votes', coalesce((select jsonb_agg(jsonb_build_object('item_id',v.hunt_item_id,'voting_team_id',v.voting_team_id,'selected_team_id',v.selected_team_id)) from public.hunt_votes v where v.hunt_id=p_hunt_id),'[]'::jsonb)
  ) into v_data;
  return v_data;
end;
$$;
revoke all on function public.get_hunt_review_gallery(uuid) from public;
grant execute on function public.get_hunt_review_gallery(uuid) to authenticated;

commit;
