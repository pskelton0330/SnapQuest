-- Phase 5: team voting and server-calculated final scores.
create table if not exists public.hunt_votes (
  id uuid primary key default gen_random_uuid(),
  hunt_id uuid not null references public.hunts(id) on delete cascade,
  hunt_item_id uuid not null,
  voting_team_id uuid not null,
  selected_team_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (hunt_item_id, hunt_id) references public.hunt_items(id, hunt_id) on delete cascade,
  foreign key (voting_team_id, hunt_id) references public.teams(id, hunt_id) on delete cascade,
  foreign key (selected_team_id, hunt_id) references public.teams(id, hunt_id) on delete cascade,
  unique (hunt_item_id, voting_team_id),
  check (voting_team_id <> selected_team_id)
);

alter table public.hunts add column if not exists final_scores jsonb not null default '[]'::jsonb;
alter table public.hunt_votes enable row level security;
drop policy if exists "Teams read hunt votes during review" on public.hunt_votes;
create policy "Teams read hunt votes during review" on public.hunt_votes
  for select to authenticated using (
    public.is_hunt_organizer(hunt_id)
    or (public.is_hunt_participant(hunt_id) and exists (
      select 1 from public.hunts h where h.id = hunt_id and h.status in ('review','completed')
    ))
  );
grant select on public.hunt_votes to authenticated;

create or replace function public.get_hunt_review_gallery(p_hunt_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hunt public.hunts%rowtype; v_data jsonb;
begin
  select * into v_hunt from public.hunts h where h.id = p_hunt_id;
  if not found or not (public.is_hunt_organizer(p_hunt_id) or public.is_hunt_participant(p_hunt_id)) then
    raise exception 'Hunt access required';
  end if;
  if v_hunt.status not in ('review','completed') and v_hunt.ended_at is null
     and clock_timestamp() < v_hunt.start_at + make_interval(mins => v_hunt.duration_minutes) then
    raise exception 'The gallery opens after the hunt ends';
  end if;
  select jsonb_build_object(
    'voting_enabled', v_hunt.voting_enabled,
    'voting_bonus_points', v_hunt.voting_bonus_points,
    'status', v_hunt.status,
    'final_scores', v_hunt.final_scores,
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'display_color',t.display_color) order by t.display_order) from public.teams t where t.hunt_id=p_hunt_id),'[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'title',i.title_snapshot,'points',i.point_value,'display_order',i.display_order) order by i.display_order) from public.hunt_items i where i.hunt_id=p_hunt_id),'[]'::jsonb),
    'submissions', coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'item_id',s.hunt_item_id,'team_id',s.team_id,'participant_id',s.participant_id,'storage_path',s.storage_path,'status',s.approval_status,'submitted_at',s.submitted_at)) from public.submissions s where s.hunt_id=p_hunt_id),'[]'::jsonb),
    'votes', coalesce((select jsonb_agg(jsonb_build_object('item_id',v.hunt_item_id,'voting_team_id',v.voting_team_id,'selected_team_id',v.selected_team_id)) from public.hunt_votes v where v.hunt_id=p_hunt_id),'[]'::jsonb)
  ) into v_data;
  return v_data;
end $$;
revoke all on function public.get_hunt_review_gallery(uuid) from public;
grant execute on function public.get_hunt_review_gallery(uuid) to authenticated;

create or replace function public.cast_hunt_vote(p_hunt_id uuid,p_hunt_item_id uuid,p_selected_team_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_participant public.participants%rowtype; v_hunt public.hunts%rowtype;
begin
  select * into v_participant from public.participants p where p.hunt_id=p_hunt_id and p.auth_user_id=auth.uid();
  if not found then raise exception 'Participant access required'; end if;
  select * into v_hunt from public.hunts h where h.id=p_hunt_id for update;
  if v_hunt.status <> 'review' or not v_hunt.voting_enabled then raise exception 'Voting is not open'; end if;
  if not exists(select 1 from public.submissions s where s.hunt_id=p_hunt_id and s.hunt_item_id=p_hunt_item_id and s.team_id=p_selected_team_id and s.approval_status='approved') then
    raise exception 'You can vote only for an approved photo';
  end if;
  if p_selected_team_id=v_participant.team_id then raise exception 'You cannot vote for your own team'; end if;
  insert into public.hunt_votes(hunt_id,hunt_item_id,voting_team_id,selected_team_id)
  values(p_hunt_id,p_hunt_item_id,v_participant.team_id,p_selected_team_id)
  on conflict(hunt_item_id,voting_team_id) do update set selected_team_id=excluded.selected_team_id,created_at=clock_timestamp();
end $$;
revoke all on function public.cast_hunt_vote(uuid,uuid,uuid) from public;
grant execute on function public.cast_hunt_vote(uuid,uuid,uuid) to authenticated;

create or replace function public.finalize_hunt(p_hunt_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_hunt public.hunts%rowtype; v_scores jsonb;
begin
  if auth.uid() is null or not public.is_hunt_organizer(p_hunt_id) then raise exception 'Organizer access required'; end if;
  select * into v_hunt from public.hunts h where h.id=p_hunt_id for update;
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
end $$;
revoke all on function public.finalize_hunt(uuid) from public;
grant execute on function public.finalize_hunt(uuid) to authenticated;

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='hunt_votes') then
    alter publication supabase_realtime add table public.hunt_votes;
  end if;
end $$;
