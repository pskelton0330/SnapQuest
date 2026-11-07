-- Supabase grants EXECUTE to anon by default. Keep public discovery and invite
-- preview callable, but require authenticated identity for every other app RPC.
alter default privileges for role postgres in schema public
  revoke execute on functions from anon;

do $$
declare
  v_function record;
begin
  for v_function in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.oid not in (
        'public.list_hunt_templates(boolean)'::regprocedure,
        'public.preview_invitation(text)'::regprocedure
      )
  loop
    execute format('revoke execute on function %s from anon', v_function.signature);
  end loop;
end;
$$;

grant execute on function public.list_hunt_templates(boolean) to anon;
grant execute on function public.preview_invitation(text) to anon;

notify pgrst, 'reload schema';
