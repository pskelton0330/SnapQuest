begin;

do $$
declare
  target_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication is unavailable; realtime subscriptions remain disabled';
    return;
  end if;

  foreach target_table in array array[
    'hunt_messages',
    'hunts',
    'hunt_votes',
    'participants',
    'submissions',
    'team_selfies',
    'teams'
  ] loop
    if to_regclass(format('public.%I', target_table)) is not null
       and not exists (
         select 1
         from pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = 'public'
           and tablename = target_table
       ) then
      execute format('alter publication supabase_realtime add table public.%I', target_table);
    end if;
  end loop;
end;
$$;

commit;
