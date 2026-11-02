-- Phase 4 foundation: one private, replaceable photo per team and hunt item.
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.teams'::regclass and conname='teams_id_hunt_unique') then
    alter table public.teams add constraint teams_id_hunt_unique unique (id, hunt_id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.hunt_items'::regclass and conname='hunt_items_id_hunt_unique') then
    alter table public.hunt_items add constraint hunt_items_id_hunt_unique unique (id, hunt_id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.participants'::regclass and conname='participants_identity_team_unique') then
    alter table public.participants add constraint participants_identity_team_unique unique (id, hunt_id, team_id);
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hunt-photos', 'hunt-photos', false, 8388608, array['image/jpeg']::text[])
on conflict (id) do update
set public = false, file_size_limit = 8388608, allowed_mime_types = array['image/jpeg']::text[];

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  hunt_id uuid not null references public.hunts(id) on delete cascade,
  hunt_item_id uuid not null,
  team_id uuid not null,
  participant_id uuid not null,
  storage_path text not null unique,
  submitted_at timestamptz not null default now(),
  approval_status text not null default 'pending' check (approval_status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  foreign key (hunt_item_id, hunt_id) references public.hunt_items(id, hunt_id) on delete cascade,
  foreign key (team_id, hunt_id) references public.teams(id, hunt_id) on delete cascade,
  foreign key (participant_id, hunt_id, team_id) references public.participants(id, hunt_id, team_id) on delete cascade,
  unique (hunt_item_id, team_id)
);

create index if not exists submissions_hunt_item_idx on public.submissions(hunt_id, hunt_item_id, team_id);
alter table public.submissions enable row level security;

create or replace function public.can_submit_hunt_photo(p_path text)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_hunt_id uuid;
  v_team_id uuid;
  v_item_id uuid;
begin
  if auth.uid() is null or array_length(string_to_array(p_path, '/'), 1) <> 4
     or split_part(p_path, '/', 4) !~ '^[0-9a-fA-F-]{36}\.jpg$' then return false; end if;
  v_hunt_id := split_part(p_path, '/', 1)::uuid;
  v_team_id := split_part(p_path, '/', 2)::uuid;
  v_item_id := split_part(p_path, '/', 3)::uuid;
  return exists (
    select 1 from public.participants p
    join public.hunts h on h.id = p.hunt_id
    join public.hunt_items i on i.hunt_id = h.id and i.id = v_item_id
    where p.auth_user_id = auth.uid() and p.hunt_id = v_hunt_id and p.team_id = v_team_id
      and h.status in ('scheduled','active') and h.ended_at is null
      and h.start_at <= clock_timestamp()
      and clock_timestamp() < h.start_at + make_interval(mins => h.duration_minutes)
  );
exception when invalid_text_representation then return false;
end;
$$;

create or replace function public.can_view_hunt_photo(p_path text)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_hunt_id uuid;
  v_team_id uuid;
begin
  if array_length(string_to_array(p_path, '/'), 1) <> 4 then return false; end if;
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

create or replace function public.can_delete_hunt_photo(p_path text)
returns boolean
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_hunt_id uuid;
  v_team_id uuid;
begin
  if array_length(string_to_array(p_path, '/'), 1) <> 4 then return false; end if;
  v_hunt_id := split_part(p_path, '/', 1)::uuid;
  v_team_id := split_part(p_path, '/', 2)::uuid;
  return public.is_hunt_organizer(v_hunt_id) or public.is_hunt_team_member(v_hunt_id, v_team_id);
exception when invalid_text_representation then return false;
end;
$$;

revoke all on function public.can_submit_hunt_photo(text) from public;
revoke all on function public.can_view_hunt_photo(text) from public;
revoke all on function public.can_delete_hunt_photo(text) from public;
grant execute on function public.can_submit_hunt_photo(text) to authenticated;
grant execute on function public.can_view_hunt_photo(text) to authenticated;
grant execute on function public.can_delete_hunt_photo(text) to authenticated;

drop policy if exists "Team participants upload active hunt photos" on storage.objects;
drop policy if exists "Authorized users view private hunt photos" on storage.objects;
drop policy if exists "Team participants remove their hunt photos" on storage.objects;
create policy "Team participants upload active hunt photos" on storage.objects
  for insert to authenticated with check (bucket_id = 'hunt-photos' and public.can_submit_hunt_photo(name));
create policy "Authorized users view private hunt photos" on storage.objects
  for select to authenticated using (bucket_id = 'hunt-photos' and public.can_view_hunt_photo(name));
create policy "Team participants remove their hunt photos" on storage.objects
  for delete to authenticated using (bucket_id = 'hunt-photos' and public.can_delete_hunt_photo(name));

drop policy if exists "Authorized users see submissions" on public.submissions;
create policy "Authorized users see submissions" on public.submissions
  for select to authenticated using (
    public.is_hunt_organizer(hunt_id)
    or public.is_hunt_team_member(hunt_id, team_id)
    or (public.is_hunt_participant(hunt_id) and exists (
      select 1 from public.hunts h where h.id = hunt_id
        and (h.status in ('review','completed') or h.ended_at is not null
          or clock_timestamp() >= h.start_at + make_interval(mins => h.duration_minutes))
    ))
  );
grant select on public.submissions to authenticated;

-- Upload first to a private, policy-checked key; this RPC is the authoritative acceptance step.
create or replace function public.submit_hunt_photo(p_hunt_item_id uuid, p_storage_path text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_participant public.participants%rowtype;
  v_hunt public.hunts%rowtype;
  v_item public.hunt_items%rowtype;
  v_old_path text;
  v_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null then raise exception 'A participant session is required'; end if;
  if array_length(string_to_array(p_storage_path, '/'), 1) <> 4
     or split_part(p_storage_path, '/', 4) !~ '^[0-9a-fA-F-]{36}\.jpg$' then
    raise exception 'The uploaded photo reference is invalid';
  end if;
  select * into v_item from public.hunt_items i where i.id = p_hunt_item_id;
  if not found then raise exception 'This photo challenge is not available'; end if;
  select * into v_participant from public.participants p
  where p.hunt_id = v_item.hunt_id and p.auth_user_id = auth.uid();
  if not found then raise exception 'You are not a participant in this hunt'; end if;
  if split_part(p_storage_path, '/', 1)::uuid <> v_item.hunt_id
     or split_part(p_storage_path, '/', 2)::uuid <> v_participant.team_id
     or split_part(p_storage_path, '/', 3)::uuid <> v_item.id then
    raise exception 'This photo does not belong to your team and challenge';
  end if;
  select * into v_hunt from public.hunts h where h.id = v_item.hunt_id for update;
  if v_hunt.status not in ('scheduled','active') or v_hunt.ended_at is not null
     or v_hunt.start_at is null or v_now < v_hunt.start_at
     or v_now >= v_hunt.start_at + make_interval(mins => v_hunt.duration_minutes) then
    raise exception 'The photo deadline has passed';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'hunt-photos' and o.name = p_storage_path) then
    raise exception 'The uploaded photo was not found';
  end if;

  select s.storage_path into v_old_path from public.submissions s
  where s.hunt_item_id = v_item.id and s.team_id = v_participant.team_id for update;
  if found then
    update public.submissions set participant_id = v_participant.id, storage_path = p_storage_path,
      submitted_at = v_now, approval_status = 'pending', reviewed_by = null, reviewed_at = null
    where hunt_item_id = v_item.id and team_id = v_participant.team_id;
  else
    insert into public.submissions(hunt_id, hunt_item_id, team_id, participant_id, storage_path, submitted_at)
    values (v_item.hunt_id, v_item.id, v_participant.team_id, v_participant.id, p_storage_path, v_now);
  end if;
  return jsonb_build_object('accepted', true, 'submitted_at', v_now, 'previous_storage_path', v_old_path);
end;
$$;

revoke all on function public.submit_hunt_photo(uuid, text) from public;
grant execute on function public.submit_hunt_photo(uuid, text) to authenticated;

create or replace function public.review_submission(p_submission_id uuid, p_decision text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.submissions%rowtype;
  v_hunt public.hunts%rowtype;
begin
  select * into v_submission from public.submissions s where s.id = p_submission_id;
  if not found or not public.is_hunt_organizer(v_submission.hunt_id) then
    raise exception 'Organizer access required';
  end if;
  if p_decision not in ('approved','rejected') then raise exception 'Choose approve or reject'; end if;
  select * into v_hunt from public.hunts h where h.id = v_submission.hunt_id;
  if v_hunt.status not in ('review','completed') and v_hunt.ended_at is null
     and clock_timestamp() < v_hunt.start_at + make_interval(mins => v_hunt.duration_minutes) then
    raise exception 'Photo review opens after the hunt ends';
  end if;
  update public.submissions set approval_status = p_decision, reviewed_by = auth.uid(), reviewed_at = clock_timestamp()
  where id = p_submission_id;
end;
$$;

revoke all on function public.review_submission(uuid, text) from public;
grant execute on function public.review_submission(uuid, text) to authenticated;

create or replace function public.begin_hunt_review(p_hunt_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hunt public.hunts%rowtype;
begin
  if auth.uid() is null or not public.is_hunt_organizer(p_hunt_id) then raise exception 'Organizer access required'; end if;
  select * into v_hunt from public.hunts h where h.id = p_hunt_id for update;
  if v_hunt.status not in ('scheduled','active') then raise exception 'This hunt is not ready for review'; end if;
  if v_hunt.ended_at is null and (v_hunt.start_at is null or clock_timestamp() < v_hunt.start_at + make_interval(mins => v_hunt.duration_minutes)) then
    raise exception 'You can review photos after the hunt ends';
  end if;
  update public.hunts set status = 'review', ended_at = coalesce(ended_at, clock_timestamp()) where id = p_hunt_id;
end;
$$;

revoke all on function public.begin_hunt_review(uuid) from public;
grant execute on function public.begin_hunt_review(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'submissions') then
    alter publication supabase_realtime add table public.submissions;
  end if;
end;
$$;
