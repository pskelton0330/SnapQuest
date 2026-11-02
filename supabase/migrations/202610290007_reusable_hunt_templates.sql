-- v1.2 Phase 2. Existing public.hunts rows remain game instances.
begin;
create table if not exists public.hunt_creator_profiles (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null unique references public.organizers(id),
  display_name text not null default 'SnapQuest organizer' check (length(trim(display_name)) between 1 and 80)
);
create table if not exists public.hunt_templates (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references public.organizers(id),
  creator_profile_id uuid not null references public.hunt_creator_profiles(id),
  title text not null check (length(trim(title)) between 1 and 120),
  venue text not null check (length(trim(venue)) between 1 and 160),
  description text not null default '' check (length(description) <= 1000),
  rules text[] not null default '{}',
  default_duration_minutes integer not null default 60 check (default_duration_minutes between 5 and 1440),
  visibility text not null default 'public' check (visibility in ('public','personal')),
  legacy_game_id uuid unique references public.hunts(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.hunt_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.hunt_templates(id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 120),
  description text not null default '' check (length(description) <= 1000),
  points integer not null default 1 check (points between 0 and 1000),
  display_order integer not null check (display_order >= 0),
  unique(template_id,display_order)
);
alter table public.hunts add column if not exists template_id uuid references public.hunt_templates(id);
alter table public.hunts add column if not exists template_snapshot jsonb;
create index if not exists hunt_templates_owner_idx on public.hunt_templates(organizer_id);
create index if not exists hunt_templates_public_idx on public.hunt_templates(created_at desc) where visibility='public';
create index if not exists games_template_idx on public.hunts(template_id);
alter table public.hunt_creator_profiles enable row level security;
alter table public.hunt_templates enable row level security;
alter table public.hunt_template_items enable row level security;
drop policy if exists "Read own creator profile" on public.hunt_creator_profiles;
create policy "Read own creator profile" on public.hunt_creator_profiles for select to authenticated
  using (exists(select 1 from public.organizers o where o.id=organizer_id and o.auth_user_id=auth.uid()));
drop policy if exists "Read own templates" on public.hunt_templates;
create policy "Read own templates" on public.hunt_templates for select to authenticated
  using (exists(select 1 from public.organizers o where o.id=organizer_id and o.auth_user_id=auth.uid()));
drop policy if exists "Read own template challenges" on public.hunt_template_items;
create policy "Read own template challenges" on public.hunt_template_items for select to authenticated
  using (exists(select 1 from public.hunt_templates t join public.organizers o on o.id=t.organizer_id where t.id=template_id and o.auth_user_id=auth.uid()));
-- Public discovery is only through the safe-document RPC, never raw private rows.
revoke all on public.hunt_templates, public.hunt_template_items, public.hunt_creator_profiles from anon, authenticated;
grant select on public.hunt_templates, public.hunt_template_items, public.hunt_creator_profiles to authenticated;

create or replace function public.hunt_template_document(p_id uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',t.id,'title',t.title,'venue',t.venue,'description',t.description,
    'creatorId',c.id,'creatorName',c.display_name,'visibility',t.visibility,'rules',t.rules,
    'defaultDuration',t.default_duration_minutes,'createdAt',t.created_at,
    'challenges',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'title',i.title,'description',i.description,'points',i.points) order by i.display_order) from public.hunt_template_items i where i.template_id=t.id),'[]'::jsonb))
  from public.hunt_templates t join public.hunt_creator_profiles c on c.id=t.creator_profile_id where t.id=p_id;
$$;
revoke all on function public.hunt_template_document(uuid) from public,anon,authenticated;

create or replace function public.list_hunt_templates(p_owned boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_owner uuid;
begin
  select id into v_owner from public.organizers where auth_user_id=auth.uid();
  if p_owned and v_owner is null then raise exception 'Organizer access required'; end if;
  return coalesce((select jsonb_agg(public.hunt_template_document(t.id) order by t.created_at desc,t.id)
    from public.hunt_templates t where (p_owned and t.organizer_id=v_owner) or (not p_owned and t.visibility='public')),'[]'::jsonb);
end $$;
revoke all on function public.list_hunt_templates(boolean) from public;
grant execute on function public.list_hunt_templates(boolean) to anon,authenticated;

create or replace function public.set_hunt_creator_name(p_display_name text) returns void
language plpgsql security definer set search_path='' as $$
declare v_owner uuid;
begin
  select id into v_owner from public.organizers where auth_user_id=auth.uid();
  if v_owner is null then raise exception 'Organizer access required'; end if;
  insert into public.hunt_creator_profiles(organizer_id,display_name) values(v_owner,trim(p_display_name))
  on conflict(organizer_id) do update set display_name=excluded.display_name;
end $$;
revoke all on function public.set_hunt_creator_name(text) from public;
grant execute on function public.set_hunt_creator_name(text) to authenticated;

create or replace function public.save_hunt_template(p_title text,p_venue text,p_description text,p_rules text[],p_items jsonb,p_duration integer default 60,p_visibility text default 'public',p_template_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_owner uuid; v_creator uuid; v_id uuid; v_item jsonb; v_order integer:=0;
begin
  select id into v_owner from public.organizers where auth_user_id=auth.uid();
  if v_owner is null then raise exception 'Organizer access required'; end if;
  if p_title is null or p_venue is null or p_duration is null or p_visibility is null or p_items is null
    or jsonb_typeof(p_items)<>'array' then raise exception 'Valid hunt details and challenges required'; end if;
  if jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Use 1 to 100 challenges'; end if;
  if cardinality(coalesce(p_rules,'{}'))>30 or exists(select 1 from unnest(p_rules) r where r is null or length(r)>1000) then raise exception 'Invalid rules'; end if;
  insert into public.hunt_creator_profiles(organizer_id) values(v_owner) on conflict(organizer_id) do nothing;
  select id into v_creator from public.hunt_creator_profiles where organizer_id=v_owner;
  if p_template_id is null then
    insert into public.hunt_templates(organizer_id,creator_profile_id,title,venue,description,rules,default_duration_minutes,visibility)
    values(v_owner,v_creator,trim(p_title),trim(p_venue),coalesce(p_description,''),coalesce(p_rules,'{}'),p_duration,p_visibility) returning id into v_id;
  else
    select id into v_id from public.hunt_templates where id=p_template_id and organizer_id=v_owner for update;
    if v_id is null then raise exception 'Template ownership required'; end if;
    update public.hunt_templates set title=trim(p_title),venue=trim(p_venue),description=coalesce(p_description,''),rules=coalesce(p_rules,'{}'),default_duration_minutes=p_duration,visibility=p_visibility where id=v_id;
    delete from public.hunt_template_items where template_id=v_id;
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    insert into public.hunt_template_items(template_id,title,description,points,display_order)
    values(v_id,trim(v_item->>'title'),coalesce(v_item->>'description',''),coalesce((v_item->>'points')::integer,1),v_order);
    v_order:=v_order+1;
  end loop;
  return v_id;
end $$;
revoke all on function public.save_hunt_template(text,text,text,text[],jsonb,integer,text,uuid) from public;
grant execute on function public.save_hunt_template(text,text,text,text[],jsonb,integer,text,uuid) to authenticated;

create or replace function public.copy_hunt_template(p_template_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_template public.hunt_templates%rowtype; v_owner uuid; v_id uuid;
begin
  select id into v_owner from public.organizers where auth_user_id=auth.uid();
  if v_owner is null then raise exception 'Organizer access required'; end if;
  select * into v_template from public.hunt_templates where id=p_template_id and (visibility='public' or organizer_id=v_owner) for share;
  if not found then raise exception 'Hunt not available'; end if;
  v_id:=public.save_hunt_template(v_template.title,v_template.venue,v_template.description,v_template.rules,
    (public.hunt_template_document(p_template_id))->'challenges',v_template.default_duration_minutes,'personal',null);
  return v_id;
end $$;
revoke all on function public.copy_hunt_template(uuid) from public;
grant execute on function public.copy_hunt_template(uuid) to authenticated;

create or replace function public.create_game_from_template(p_template_id uuid,p_game_name text default null,p_duration integer default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_owner uuid; v_template public.hunt_templates%rowtype; v_id uuid;
begin
  select id into v_owner from public.organizers where auth_user_id=auth.uid();
  if v_owner is null then raise exception 'Organizer access required'; end if;
  select * into v_template from public.hunt_templates where id=p_template_id and (visibility='public' or organizer_id=v_owner) for share;
  if not found then raise exception 'Hunt not available'; end if;
  if not exists(select 1 from public.hunt_template_items where template_id=p_template_id) then raise exception 'Hunt has no challenges'; end if;
  insert into public.hunts(organizer_id,title,venue,description,rules,duration_minutes,template_id,template_snapshot)
  values(v_owner,coalesce(nullif(trim(p_game_name),''),v_template.title),v_template.venue,v_template.description,v_template.rules,
    coalesce(p_duration,v_template.default_duration_minutes),v_template.id,public.hunt_template_document(v_template.id)) returning id into v_id;
  insert into public.hunt_items(hunt_id,title_snapshot,description_snapshot,point_value,display_order)
  select v_id,title,nullif(description,''),points,display_order from public.hunt_template_items where template_id=p_template_id;
  return v_id;
end $$;
revoke all on function public.create_game_from_template(uuid,text,integer) from public;
grant execute on function public.create_game_from_template(uuid,text,integer) to authenticated;

-- Repeatable backfill: old games stay private and retain every original ID/child row.
insert into public.hunt_creator_profiles(organizer_id) select distinct organizer_id from public.hunts on conflict(organizer_id) do nothing;
insert into public.hunt_templates(organizer_id,creator_profile_id,title,venue,description,rules,default_duration_minutes,visibility,legacy_game_id,created_at)
select h.organizer_id,c.id,h.title,h.venue,coalesce(h.description,''),h.rules,h.duration_minutes,'personal',h.id,h.created_at
from public.hunts h join public.hunt_creator_profiles c on c.organizer_id=h.organizer_id
where h.template_id is null on conflict(legacy_game_id) do nothing;
insert into public.hunt_template_items(template_id,title,description,points,display_order)
select t.id,i.title_snapshot,coalesce(i.description_snapshot,''),i.point_value,i.display_order
from public.hunt_templates t join public.hunt_items i on i.hunt_id=t.legacy_game_id
join public.hunts h on h.id=t.legacy_game_id where h.template_id is null
on conflict(template_id,display_order) do nothing;
update public.hunts h set template_id=t.id,template_snapshot=public.hunt_template_document(t.id)
from public.hunt_templates t where t.legacy_game_id=h.id and h.template_id is null;
commit;
