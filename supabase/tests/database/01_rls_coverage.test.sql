-- Structural guarantees: every table is protected, anonymous visitors get
-- nothing, and learner/audit tables are read-only for signed-in users.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select is(
  (select array_agg(c.relname order by c.relname)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and not (c.relrowsecurity and c.relforcerowsecurity)),
  null,
  'every public table has row level security enabled and forced'
);

select is(
  (select array_agg(c.relname::text order by c.relname)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and (has_table_privilege('anon', c.oid, 'SELECT')
       or has_table_privilege('anon', c.oid, 'INSERT')
       or has_table_privilege('anon', c.oid, 'UPDATE')
       or has_table_privilege('anon', c.oid, 'DELETE'))),
  null,
  'anonymous role has no privilege on any public table'
);

select is(
  (select array_agg(t order by t)
   from unnest(array['attempts', 'responses', 'section_progress', 'vocab_review_state',
                     'learning_events', 'recommendation_feedback', 'audit_log']) as t
   where has_table_privilege('authenticated', format('public.%I', t), 'INSERT')
      or has_table_privilege('authenticated', format('public.%I', t), 'UPDATE')
      or has_table_privilege('authenticated', format('public.%I', t), 'DELETE')),
  null,
  'signed-in users cannot write learner records or the audit log directly'
);

select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'id', 'UPDATE'),
  'signed-in users cannot change a profile id'
);

select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'),
  0::bigint,
  'no functions in the API-exposed public schema (nothing callable as RPC)'
);

select is(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and has_function_privilege('anon', p.oid, 'EXECUTE')),
  null,
  'anonymous role cannot execute any authorization helper'
);

select * from finish();
rollback;
