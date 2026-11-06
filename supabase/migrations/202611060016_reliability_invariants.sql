begin;

-- Preserve the historical submitter while a participant changes teams.
alter table public.participants
  add constraint participants_id_hunt_unique unique (id, hunt_id);

alter table public.team_selfies
  drop constraint if exists team_selfies_submitted_by_hunt_id_team_id_fkey;
alter table public.team_selfies
  add constraint team_selfies_submitted_by_hunt_id_fkey
  foreign key (submitted_by, hunt_id)
  references public.participants(id, hunt_id) on delete cascade;

-- A referenced photo or selfie cannot be removed through ordinary object cleanup.
create or replace function public.can_delete_hunt_photo(p_path text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_hunt_id uuid; v_team_id uuid;
begin
  if array_length(string_to_array(p_path, '/'), 1) <> 4 then return false; end if;
  v_hunt_id := split_part(p_path, '/', 1)::uuid;
  v_team_id := split_part(p_path, '/', 2)::uuid;
  if not (public.is_hunt_organizer(v_hunt_id) or public.is_hunt_team_member(v_hunt_id, v_team_id)) then
    return false;
  end if;
  return not exists (select 1 from public.submissions s where s.storage_path = p_path)
    and not exists (select 1 from public.team_selfies s where s.storage_path = p_path);
exception when invalid_text_representation then return false;
end;
$$;
revoke all on function public.can_delete_hunt_photo(text) from public;
grant execute on function public.can_delete_hunt_photo(text) to authenticated;

create or replace function public.can_delete_team_selfie(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_view_team_selfie(p_path)
    and not exists (select 1 from public.team_selfies s where s.storage_path = p_path)
$$;
revoke all on function public.can_delete_team_selfie(text) from public;
grant execute on function public.can_delete_team_selfie(text) to authenticated;

-- Manual-start and scheduled pre-start galleries stay closed, including through RPC calls.
create or replace function public.get_hunt_review_gallery(p_hunt_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hunt public.hunts%rowtype; v_data jsonb;
begin
  select * into v_hunt from public.hunts h where h.id = p_hunt_id;
  if not found or not (public.is_hunt_organizer(p_hunt_id) or public.is_hunt_participant(p_hunt_id)) then
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
    'submissions', coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'item_id',s.hunt_item_id,'team_id',s.team_id,'participant_id',s.participant_id,'storage_path',s.storage_path,'status',s.approval_status,'submitted_at',s.submitted_at)) from public.submissions s where s.hunt_id=p_hunt_id),'[]'::jsonb),
    'votes', coalesce((select jsonb_agg(jsonb_build_object('item_id',v.hunt_item_id,'voting_team_id',v.voting_team_id,'selected_team_id',v.selected_team_id)) from public.hunt_votes v where v.hunt_id=p_hunt_id),'[]'::jsonb)
  ) into v_data;
  return v_data;
end;
$$;
revoke all on function public.get_hunt_review_gallery(uuid) from public;
grant execute on function public.get_hunt_review_gallery(uuid) to authenticated;

-- Keep lock order consistent: hunt first, then submission, as in photo acceptance.
create or replace function public.review_submission(p_submission_id uuid, p_decision text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_hunt_id uuid; v_hunt public.hunts%rowtype; v_submission public.submissions%rowtype;
begin
  if auth.uid() is null then raise exception 'Organizer access required'; end if;
  if p_decision not in ('approved','rejected') then raise exception 'Choose approve or reject'; end if;
  select s.hunt_id into v_hunt_id from public.submissions s where s.id=p_submission_id;
  if not found or not public.is_hunt_organizer(v_hunt_id) then raise exception 'Organizer access required'; end if;
  select * into v_hunt from public.hunts h where h.id=v_hunt_id for update;
  select * into v_submission from public.submissions s where s.id=p_submission_id and s.hunt_id=v_hunt_id for update;
  if not found then raise exception 'Photo submission no longer exists'; end if;
  if v_hunt.status <> 'review' then raise exception 'Photo review is not open'; end if;
  update public.submissions set approval_status=p_decision, reviewed_by=auth.uid(), reviewed_at=clock_timestamp()
  where id=p_submission_id;
end;
$$;
revoke all on function public.review_submission(uuid,text) from public;
grant execute on function public.review_submission(uuid,text) to authenticated;

-- Finalization retries after a lost response return the original immutable snapshot.
create or replace function public.finalize_hunt(p_hunt_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hunt public.hunts%rowtype; v_scores jsonb;
begin
  if auth.uid() is null or not public.is_hunt_organizer(p_hunt_id) then raise exception 'Organizer access required'; end if;
  select * into v_hunt from public.hunts h where h.id=p_hunt_id for update;
  if v_hunt.status='completed' and v_hunt.final_scores is not null then return v_hunt.final_scores; end if;
  if v_hunt.status <> 'review' then raise exception 'Move the hunt into review before finalizing'; end if;
  if exists(select 1 from public.submissions s where s.hunt_id=p_hunt_id and s.approval_status='pending') then
    raise exception 'Review or reject every submitted photo before finalizing';
  end if;
  with base as (
    select t.id team_id,t.name team_name,
      coalesce(sum(i.point_value) filter(where s.approval_status='approved'),0)::integer base_points
    from public.teams t left join public.submissions s on s.team_id=t.id and s.hunt_id=t.hunt_id
    left join public.hunt_items i on i.id=s.hunt_item_id and i.hunt_id=s.hunt_id
    where t.hunt_id=p_hunt_id group by t.id,t.name
  ), vote_counts as (
    select v.hunt_item_id,v.selected_team_id,count(*) votes
    from public.hunt_votes v join public.submissions s on s.hunt_id=v.hunt_id and s.hunt_item_id=v.hunt_item_id and s.team_id=v.selected_team_id and s.approval_status='approved'
    where v.hunt_id=p_hunt_id group by v.hunt_item_id,v.selected_team_id
  ), vote_max as (select hunt_item_id,max(votes) votes from vote_counts group by hunt_item_id), bonuses as (
    select vc.selected_team_id team_id,sum(v_hunt.voting_bonus_points)::integer voting_bonus
    from vote_counts vc join vote_max vm using(hunt_item_id) where vc.votes=vm.votes and v_hunt.voting_enabled and v_hunt.voting_bonus_points>0 group by vc.selected_team_id
  ), totals as (
    select b.team_id,b.team_name,b.base_points,coalesce(x.voting_bonus,0) voting_bonus,b.base_points+coalesce(x.voting_bonus,0) total
    from base b left join bonuses x using(team_id)
  ), ranked as (
    select *,dense_rank() over(order by total desc) rank from totals
  )
  select coalesce(jsonb_agg(jsonb_build_object('team_id',team_id,'team_name',team_name,'base_points',base_points,'voting_bonus',voting_bonus,'total',total,'rank',rank) order by rank,team_name),'[]'::jsonb) into v_scores from ranked;
  update public.hunts set status='completed',final_scores=v_scores where id=p_hunt_id;
  return v_scores;
end;
$$;
revoke all on function public.finalize_hunt(uuid) from public;
grant execute on function public.finalize_hunt(uuid) to authenticated;

commit;
