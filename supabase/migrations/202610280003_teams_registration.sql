-- Phase 2: organizer teams, hashed invitations, and participant registration.
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  hunt_id uuid not null references public.hunts(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 40),
  display_color text not null default '#E87983' check (display_color ~ '^#[0-9A-Fa-f]{6}$'),
  display_order integer not null check (display_order >= 0),
  created_at timestamptz not null default now(),
  unique (hunt_id, id),
  unique (hunt_id, name),
  unique (hunt_id, display_order)
);

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  hunt_id uuid not null references public.hunts(id) on delete cascade,
  team_id uuid,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (hunt_id, team_id) references public.teams(hunt_id, id) on delete cascade
);

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  hunt_id uuid not null references public.hunts(id) on delete cascade,
  team_id uuid not null,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 40),
  joined_at timestamptz not null default now(),
  foreign key (hunt_id, team_id) references public.teams(hunt_id, id),
  unique (hunt_id, auth_user_id)
);

create index if not exists participants_team_joined_idx on public.participants(hunt_id, team_id, joined_at);
create index if not exists invitations_hunt_idx on public.invitations(hunt_id) where revoked_at is null;

alter table public.hunts add column if not exists ended_at timestamptz;

create or replace function public.is_hunt_organizer(p_hunt_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.hunts h
    join public.organizers o on o.id = h.organizer_id
    where h.id = p_hunt_id and o.auth_user_id = auth.uid()
  );
$$;

create or replace function public.is_hunt_participant(p_hunt_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.participants p
    where p.hunt_id = p_hunt_id and p.auth_user_id = auth.uid()
  );
$$;

create or replace function public.is_hunt_team_member(p_hunt_id uuid, p_team_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.participants p
    where p.hunt_id = p_hunt_id and p.team_id = p_team_id and p.auth_user_id = auth.uid()
  );
$$;

revoke all on function public.is_hunt_organizer(uuid) from public;
revoke all on function public.is_hunt_participant(uuid) from public;
revoke all on function public.is_hunt_team_member(uuid, uuid) from public;
grant execute on function public.is_hunt_organizer(uuid) to authenticated;
grant execute on function public.is_hunt_participant(uuid) to authenticated;
grant execute on function public.is_hunt_team_member(uuid, uuid) to authenticated;

alter table public.teams enable row level security;
alter table public.invitations enable row level security;
alter table public.participants enable row level security;

drop policy if exists "Organizers manage teams" on public.teams;
drop policy if exists "Participants see their own team" on public.teams;
drop policy if exists "Organizers see participants" on public.participants;
drop policy if exists "Participants see teammates" on public.participants;
drop policy if exists "Participants read their hunt" on public.hunts;
drop policy if exists "Participants read playable hunt items" on public.hunt_items;

create policy "Organizers manage teams" on public.teams
  for all to authenticated
  using (public.is_hunt_organizer(hunt_id))
  with check (public.is_hunt_organizer(hunt_id));

create policy "Participants see their own team" on public.teams
  for select to authenticated
  using (public.is_hunt_team_member(hunt_id, id));

create policy "Organizers see participants" on public.participants
  for select to authenticated
  using (public.is_hunt_organizer(hunt_id));

create policy "Participants see teammates" on public.participants
  for select to authenticated
  using (public.is_hunt_team_member(hunt_id, team_id));

create policy "Participants read their hunt" on public.hunts
  for select to authenticated
  using (public.is_hunt_participant(id));

create policy "Participants read playable hunt items" on public.hunt_items
  for select to authenticated
  using (
    public.is_hunt_participant(hunt_id)
    and exists (
      select 1 from public.hunts h
      where h.id = hunt_id
        and (
          (h.start_at is not null
            and h.start_at <= now()
            and now() < h.start_at + make_interval(mins => h.duration_minutes))
          or h.status in ('review', 'completed')
        )
    )
  );

grant select, insert, update, delete on public.teams to authenticated;
grant select on public.participants to authenticated;
revoke all on public.invitations from anon, authenticated;

-- Organizer publishes a draft, creates teams, and receives each raw invite token once.
create or replace function public.publish_hunt(
  p_hunt_id uuid,
  p_team_names text[],
  p_assignment_mode text,
  p_start_at timestamptz,
  p_voting_enabled boolean default false,
  p_voting_bonus_points integer default 0
) returns table(team_id uuid, team_name text, invite_token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hunt public.hunts%rowtype;
  v_name text;
  v_team_id uuid;
  v_index integer := 0;
  v_token text;
  v_colors text[] := array['#E87983','#E9B44C','#8175C7','#60A897','#E58C54','#5F8DC8','#C46B9E','#82A55B','#D0695C','#718096','#BA85C4','#4F9BA8'];
begin
  if auth.uid() is null or not public.is_hunt_organizer(p_hunt_id) then
    raise exception 'Organizer access required';
  end if;
  select * into v_hunt from public.hunts h where h.id = p_hunt_id for update;
  if v_hunt.status <> 'draft' then
    raise exception 'Only a draft hunt can be published';
  end if;
  if p_assignment_mode is null or p_assignment_mode not in ('organizer','balanced') then
    raise exception 'Choose a supported team assignment method';
  end if;
  if p_start_at is null or p_start_at < now() - interval '1 minute' then
    raise exception 'Choose a start time in the future';
  end if;
  if coalesce(cardinality(p_team_names), 0) not between 2 and 12 then
    raise exception 'Add between 2 and 12 teams';
  end if;
  if exists (
    select 1 from unnest(p_team_names) n
    where char_length(trim(n)) not between 1 and 40
  ) then
    raise exception 'Team names must contain 1 to 40 characters';
  end if;
  if (select count(distinct lower(trim(n))) from unnest(p_team_names) n) <> cardinality(p_team_names) then
    raise exception 'Team names must be unique';
  end if;
  if not exists (select 1 from public.hunt_items hi where hi.hunt_id = p_hunt_id) then
    raise exception 'Add at least one photo challenge before publishing';
  end if;
  if coalesce(p_voting_bonus_points, 0) not between 0 and 1000 then
    raise exception 'Voting bonus must be between 0 and 1000 points';
  end if;

  update public.hunts
  set status = 'scheduled',
      team_assignment_mode = p_assignment_mode,
      start_at = p_start_at,
      voting_enabled = coalesce(p_voting_enabled, false),
      voting_bonus_points = coalesce(p_voting_bonus_points, 0)
  where id = p_hunt_id;

  foreach v_name in array p_team_names loop
    v_index := v_index + 1;
    insert into public.teams(hunt_id, name, display_color, display_order)
    values (p_hunt_id, trim(v_name), v_colors[v_index], v_index - 1)
    returning id into v_team_id;
    if p_assignment_mode = 'organizer' then
      v_token := encode(extensions.gen_random_bytes(32), 'hex');
      insert into public.invitations(hunt_id, team_id, token_hash)
      values (p_hunt_id, v_team_id, encode(extensions.digest(v_token, 'sha256'), 'hex'));
      team_id := v_team_id;
      team_name := trim(v_name);
      invite_token := v_token;
      return next;
    end if;
  end loop;

  if p_assignment_mode = 'balanced' then
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    insert into public.invitations(hunt_id, team_id, token_hash)
    values (p_hunt_id, null, encode(extensions.digest(v_token, 'sha256'), 'hex'));
    team_id := null;
    team_name := 'Balanced team assignment';
    invite_token := v_token;
    return next;
  end if;
end;
$$;

revoke all on function public.publish_hunt(uuid, text[], text, timestamptz, boolean, integer) from public;
grant execute on function public.publish_hunt(uuid, text[], text, timestamptz, boolean, integer) to authenticated;

-- Redeem a hashed invitation once per browser identity; lock the hunt row to balance concurrent joins.
create or replace function public.redeem_invitation(p_token text, p_display_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.invitations%rowtype;
  v_hunt public.hunts%rowtype;
  v_participant public.participants%rowtype;
  v_team_id uuid;
begin
  if auth.uid() is null then
    raise exception 'A participant session is required';
  end if;
  if p_token !~ '^[0-9a-fA-F]{64}$' then
    raise exception 'This invitation link is invalid or expired';
  end if;

  select * into v_invite
  from public.invitations i
  where i.token_hash = encode(extensions.digest(lower(p_token), 'sha256'), 'hex');
  if not found then
    raise exception 'This invitation link is invalid or expired';
  end if;

  select * into v_hunt from public.hunts h where h.id = v_invite.hunt_id for update;
  select * into v_participant
  from public.participants p
  where p.hunt_id = v_hunt.id and p.auth_user_id = auth.uid();
  if found then
    return jsonb_build_object(
      'participant_id', v_participant.id,
      'hunt_id', v_hunt.id,
      'team_id', v_participant.team_id,
      'display_name', v_participant.display_name,
      'title', v_hunt.title,
      'start_at', v_hunt.start_at,
      'duration_minutes', v_hunt.duration_minutes,
      'status', v_hunt.status
    );
  end if;

  if v_invite.revoked_at is not null then
    raise exception 'This invitation link is invalid or expired';
  end if;
  if v_hunt.status not in ('scheduled','active') or v_hunt.start_at is null
     or now() >= v_hunt.start_at + make_interval(mins => v_hunt.duration_minutes) then
    raise exception 'This hunt is not accepting participants';
  end if;
  if char_length(trim(coalesce(p_display_name, ''))) not between 1 and 40 then
    raise exception 'Enter a name up to 40 characters';
  end if;

  if v_invite.team_id is not null then
    v_team_id := v_invite.team_id;
  else
    select t.id into v_team_id
    from public.teams t
    where t.hunt_id = v_hunt.id
    order by (
      select count(*) from public.participants p
      where p.hunt_id = v_hunt.id and p.team_id = t.id
    ), extensions.gen_random_bytes(4)
    limit 1;
  end if;
  if v_team_id is null then
    raise exception 'This hunt has no available teams';
  end if;

  insert into public.participants(hunt_id, team_id, auth_user_id, display_name)
  values (v_hunt.id, v_team_id, auth.uid(), trim(p_display_name))
  returning * into v_participant;

  return jsonb_build_object(
    'participant_id', v_participant.id,
    'hunt_id', v_hunt.id,
    'team_id', v_participant.team_id,
    'display_name', v_participant.display_name,
    'title', v_hunt.title,
    'start_at', v_hunt.start_at,
    'duration_minutes', v_hunt.duration_minutes,
    'status', v_hunt.status
  );
end;
$$;

revoke all on function public.redeem_invitation(text, text) from public;
grant execute on function public.redeem_invitation(text, text) to authenticated;

-- The bearer link may reveal only basic invitation context before registration.
create or replace function public.preview_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_token !~ '^[0-9a-fA-F]{64}$' then return null; end if;
  select jsonb_build_object(
    'title', h.title,
    'venue', h.venue,
    'team_name', case when i.team_id is null then 'Balanced team assignment' else t.name end,
    'start_at', h.start_at,
    'duration_minutes', h.duration_minutes
  ) into v_result
  from public.invitations i
  join public.hunts h on h.id = i.hunt_id
  left join public.teams t on t.id = i.team_id
  where i.token_hash = encode(extensions.digest(lower(p_token), 'sha256'), 'hex')
    and i.revoked_at is null
    and h.status in ('scheduled','active')
    and h.start_at is not null
    and clock_timestamp() < h.start_at + make_interval(mins => h.duration_minutes);
  return v_result;
end;
$$;

revoke all on function public.preview_invitation(text) from public;
grant execute on function public.preview_invitation(text) to anon, authenticated;

-- Link rotation revokes every previous QR without exposing stored token hashes.
create or replace function public.regenerate_hunt_invites(p_hunt_id uuid)
returns table(team_id uuid, team_name text, invite_token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hunt public.hunts%rowtype;
  v_team public.teams%rowtype;
  v_token text;
begin
  if auth.uid() is null or not public.is_hunt_organizer(p_hunt_id) then
    raise exception 'Organizer access required';
  end if;
  select * into v_hunt from public.hunts h where h.id = p_hunt_id for update;
  if v_hunt.status not in ('scheduled','active') then
    raise exception 'Invitation links are not available for this hunt';
  end if;
  update public.invitations i set revoked_at = now()
  where i.hunt_id = p_hunt_id and i.revoked_at is null;

  if v_hunt.team_assignment_mode = 'balanced' then
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    insert into public.invitations(hunt_id, team_id, token_hash)
    values (p_hunt_id, null, encode(extensions.digest(v_token, 'sha256'), 'hex'));
    team_id := null;
    team_name := 'Balanced team assignment';
    invite_token := v_token;
    return next;
  else
    for v_team in select * from public.teams t where t.hunt_id = p_hunt_id order by t.display_order loop
      v_token := encode(extensions.gen_random_bytes(32), 'hex');
      insert into public.invitations(hunt_id, team_id, token_hash)
      values (p_hunt_id, v_team.id, encode(extensions.digest(v_token, 'sha256'), 'hex'));
      team_id := v_team.id;
      team_name := v_team.name;
      invite_token := v_token;
      return next;
    end loop;
  end if;
end;
$$;

revoke all on function public.regenerate_hunt_invites(uuid) from public;
grant execute on function public.regenerate_hunt_invites(uuid) to authenticated;

-- Organizer reassignment is allowed only before the scheduled start.
create or replace function public.move_participant(p_participant_id uuid, p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_participant public.participants%rowtype;
  v_hunt public.hunts%rowtype;
begin
  select * into v_participant from public.participants p where p.id = p_participant_id;
  if not found or not public.is_hunt_organizer(v_participant.hunt_id) then
    raise exception 'Organizer access required';
  end if;
  select * into v_hunt from public.hunts h where h.id = v_participant.hunt_id for update;
  if v_hunt.status <> 'scheduled' or v_hunt.start_at <= now() then
    raise exception 'Participants can only be moved before the hunt starts';
  end if;
  if not exists (select 1 from public.teams t where t.id = p_team_id and t.hunt_id = v_participant.hunt_id) then
    raise exception 'Choose a team in this hunt';
  end if;
  update public.participants set team_id = p_team_id where id = p_participant_id;
end;
$$;

revoke all on function public.move_participant(uuid, uuid) from public;
grant execute on function public.move_participant(uuid, uuid) to authenticated;

-- Server timestamp and runtime state keep participant countdowns independent of device clock settings.
create or replace function public.get_participant_context(p_hunt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_participant public.participants%rowtype;
  v_hunt public.hunts%rowtype;
  v_team public.teams%rowtype;
  v_now timestamptz := clock_timestamp();
  v_runtime text;
  v_teammates jsonb;
begin
  select * into v_participant from public.participants p
  where p.hunt_id = p_hunt_id and p.auth_user_id = auth.uid();
  if not found then raise exception 'No participant session was found for this hunt'; end if;
  select * into v_hunt from public.hunts h where h.id = p_hunt_id;
  select * into v_team from public.teams t where t.id = v_participant.team_id;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'display_name', p.display_name) order by p.joined_at), '[]'::jsonb)
  into v_teammates from public.participants p
  where p.hunt_id = p_hunt_id and p.team_id = v_participant.team_id;

  if v_hunt.status = 'completed' then v_runtime := 'completed';
  elsif v_hunt.status = 'review' then v_runtime := 'review';
  elsif v_hunt.ended_at is not null or (v_hunt.start_at is not null and v_now >= v_hunt.start_at + make_interval(mins => v_hunt.duration_minutes)) then v_runtime := 'ended';
  elsif v_hunt.start_at is null or v_hunt.start_at > v_now then v_runtime := 'waiting';
  else v_runtime := 'active';
  end if;

  return jsonb_build_object(
    'participant_id', v_participant.id,
    'hunt_id', v_hunt.id,
    'title', v_hunt.title,
    'venue', v_hunt.venue,
    'rules', v_hunt.rules,
    'status', v_hunt.status,
    'runtime_state', v_runtime,
    'start_at', v_hunt.start_at,
    'duration_minutes', v_hunt.duration_minutes,
    'ends_at', case when v_hunt.ended_at is not null then v_hunt.ended_at else v_hunt.start_at + make_interval(mins => v_hunt.duration_minutes) end,
    'server_now', v_now,
    'team', jsonb_build_object('id', v_team.id, 'name', v_team.name, 'display_color', v_team.display_color),
    'participant', jsonb_build_object('id', v_participant.id, 'display_name', v_participant.display_name),
    'teammates', v_teammates
  );
end;
$$;

revoke all on function public.get_participant_context(uuid) from public;
grant execute on function public.get_participant_context(uuid) to authenticated;

create or replace function public.end_hunt_early(p_hunt_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_hunt_organizer(p_hunt_id) then
    raise exception 'Organizer access required';
  end if;
  update public.hunts
  set status = 'review', ended_at = coalesce(ended_at, clock_timestamp())
  where id = p_hunt_id and status in ('scheduled','active');
  if not found then raise exception 'This hunt cannot be ended from its current state'; end if;
end;
$$;

revoke all on function public.end_hunt_early(uuid) from public;
grant execute on function public.end_hunt_early(uuid) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'participants') then
    alter publication supabase_realtime add table public.participants;
  end if;
end;
$$;
