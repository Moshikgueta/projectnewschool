-- Correcting the answer key of an answered question (ADR-041): only the
-- pedagogical manager with MFA, through public.item_corrections; the
-- answered-item triggers open for that path only, and a normal session cannot
-- open them by setting app.item_correction itself; the correction updates the
-- key, the source and the item's corrected_at, and keeps an audit row;
-- students still read no keys and no corrections.
-- Fixtures (seed.sql): item 80…01 (multiple choice, key o1, answered by
-- students A, B and D); item 80…63 (fill in the blanks, not answered).
begin;
create extension if not exists pgtap with schema extensions;
select plan(28);

create function pg_temp.scalar_as(p_email text, p_sql text, p_aal text default 'aal1')
returns bigint language plpgsql as $$
declare v_id uuid; v_n bigint;
begin
  select id into strict v_id from auth.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_id, 'role', 'authenticated', 'aal', p_aal, 'email', p_email)::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into v_n;
  perform set_config('role', 'postgres', true);
  return v_n;
end;
$$;

create function pg_temp.try_as(p_email text, p_sql text, p_aal text default 'aal1')
returns text language plpgsql as $$
declare v_id uuid; v_result text := 'ok';
begin
  select id into strict v_id from auth.users where email = p_email;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_id, 'role', 'authenticated', 'aal', p_aal, 'email', p_email)::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    execute p_sql;
  exception when others then
    v_result := sqlstate;
  end;
  perform set_config('role', 'postgres', true);
  return v_result;
end;
$$;

\set A '''student.a@example.com'''
\set TX '''teacher.x@example.com'''
\set OF '''office@example.com'''
\set PM '''manager@example.com'''
\set ANSWERED '''80000000-0000-4000-8000-000000000001'''

-- The correction request (the right answer is o2 from now on).
create temp table correction_sql as select format($$insert into public.item_corrections
    (item_id, course_id, reason, new_data, new_answer)
  values (%L, '30000000-0000-4000-8000-000000000001', 'The key marked the wrong option.',
    '{"options":[{"id":"o1","text":"Me llamo Ana."},{"id":"o2","text":"Tengo diez años."}]}',
    '{"optionIds":["o2"]}')$$, '80000000-0000-4000-8000-000000000001') as q;
grant select on correction_sql to public;

-- ── who may correct ────────────────────────────────────────────────────────
select is(pg_temp.try_as(:A, (select q from correction_sql)), '42501',
  'a student cannot correct an answer');
select is(pg_temp.try_as(:TX, (select q from correction_sql)), '42501',
  'a teacher of the course cannot');
select is(pg_temp.try_as(:OF, (select q from correction_sql), 'aal2'), '42501',
  'the office (MFA) cannot');
select is(pg_temp.try_as(:PM, (select q from correction_sql)), '42501',
  'the manager without MFA cannot');
select set_config('request.jwt.claims', '{"role":"anon"}', true) is not null as reset_claims \gset
set local role anon;
select throws_ok((select q from correction_sql), '42501', null, 'anonymous callers cannot');
reset role;
select is(
  (select answer from public.activity_item_keys where item_id = :ANSWERED),
  '{"optionIds":["o1"]}'::jsonb, 'after all of that the key is unchanged');

-- ── the bypass cannot be switched on by a normal session ──────────────────
select is(
  pg_temp.try_as(:PM, format($q$do $b$ begin
      perform set_config('app.item_correction', gen_random_uuid()::text, true);
      update public.activity_item_keys set answer = '{"optionIds":["o2"]}' where item_id = %L;
    end $b$$q$, :ANSWERED), 'aal2'),
  '23001', 'setting app.item_correction does not let the manager change an answered key directly');
select is(
  pg_temp.try_as(:PM, format($q$do $b$ begin
      perform set_config('app.item_correction', '', true);
      update public.activity_items set data = '{"options":[]}' where id = %L;
    end $b$$q$, :ANSWERED), 'aal2'),
  '23001', 'nor its options');
select is(
  pg_temp.try_as(:PM, format($$insert into app.item_correction_grants (txid, item_id, token)
      values (txid_current(), %L, gen_random_uuid())$$, :ANSWERED), 'aal2'),
  '42501', 'a session cannot write the grant the triggers look for');
select is(
  pg_temp.try_as(:PM, 'select count(*) from app.item_correction_grants', 'aal2'),
  '42501', 'or read it');
select is(
  pg_temp.try_as(:PM, format($$update public.activity_items set corrected_at = now() where id = %L$$, :ANSWERED), 'aal2'),
  '23001', 'only a correction sets corrected_at');
select is(
  pg_temp.try_as(:PM, $$select app.correct_answered_item()$$, 'aal2'),
  '42501', 'the correction function cannot be called directly');
select set_config('request.jwt.claims', '{"role":"service_role"}', true) is not null as reset_claims \gset
set local role service_role;
select throws_ok((select q from correction_sql), '42501', null,
  'the secret key (no manager session) cannot correct either');
reset role;

-- ── the manager corrects ──────────────────────────────────────────────────
select is(
  pg_temp.try_as(:PM, format($$insert into public.item_corrections
      (item_id, course_id, reason, new_data, new_answer)
    values (%L, '30000000-0000-4000-8000-000000000001', 'Changing the options.',
      '{"options":[{"id":"o1","text":"Otra cosa."},{"id":"o2","text":"Tengo diez años."}]}',
      '{"optionIds":["o2"]}')$$, :ANSWERED), 'aal2'),
  '23001', 'a correction changes the key, never the options');
select is(
  pg_temp.try_as(:PM, format($$insert into public.item_corrections
      (item_id, course_id, reason, new_data, new_answer)
    values (%L, '30000000-0000-4000-8000-000000000001', 'x',
      '{"options":[{"id":"o1","text":"Me llamo Ana."},{"id":"o2","text":"Tengo diez años."}]}',
      '{"optionIds":["o2"]}')$$, :ANSWERED), 'aal2'),
  '23514', 'a reason is required');

insert into public.activity_sources (activity_id, course_id, source)
values ('70000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
        '{"instructions": [], "items": [{"id": "item-800000000000", "type": "multipleChoice", "prompt": "¿Cómo te llamas?",
          "options": [{"text": "Me llamo Ana.", "correct": true}, {"text": "Tengo diez años.", "correct": false}]}]}');
update public.activity_items set slug = 'item-800000000000' where id = :ANSWERED;

select is(
  pg_temp.try_as(:PM, format($$insert into public.item_corrections
      (item_id, course_id, reason, new_data, new_answer, new_source)
    values (%L, '30000000-0000-4000-8000-000000000001', 'The key marked the wrong option.',
      '{"options":[{"id":"o1","text":"Me llamo Ana."},{"id":"o2","text":"Tengo diez años."}]}',
      '{"optionIds":["o2"]}',
      '{"id": "item-800000000000", "type": "multipleChoice", "prompt": "¿Cómo te llamas?",
        "options": [{"text": "Me llamo Ana.", "correct": false}, {"text": "Tengo diez años.", "correct": true}]}')$$,
    :ANSWERED), 'aal2'),
  'ok', 'the manager with MFA corrects the answer of an answered question');
select is(
  (select answer from public.activity_item_keys where item_id = :ANSWERED),
  '{"optionIds":["o2"]}'::jsonb, 'the key is corrected');
select ok(
  (select corrected_at is not null from public.activity_items where id = :ANSWERED),
  'the question records when it was corrected');
select is(
  (select source -> 'items' -> 0 -> 'options' -> 1 ->> 'correct' from public.activity_sources
    where activity_id = '70000000-0000-4000-8000-000000000001'),
  'true', 'the editor''s source shows the corrected answer');
select results_eq(
  $$select reason, old_answer, new_answer, corrected_by, activity_id, regraded_at is null
      from public.item_corrections$$,
  $$values ('The key marked the wrong option.'::text, '{"optionIds":["o1"]}'::jsonb,
            '{"optionIds":["o2"]}'::jsonb, '00000000-0000-4000-8000-0000000000c1'::uuid,
            '70000000-0000-4000-8000-000000000001'::uuid, true)$$,
  'the audit row has the old and new key, the reason, who and which exercise');
select is((select count(*) from app.item_correction_grants), 0::bigint,
  'the grant is gone once the correction is done');
select is(
  pg_temp.try_as(:PM, format($$update public.activity_item_keys set answer = '{"optionIds":["o1"]}' where item_id = %L$$, :ANSWERED), 'aal2'),
  '23001', 'afterwards the question is locked again');

-- ── the record stays as written; who reads it ─────────────────────────────
select is(
  pg_temp.try_as(:PM, $$update public.item_corrections set reason = 'Something else'$$, 'aal2'),
  '42501', 'the manager cannot rewrite a correction');
select is(
  pg_temp.try_as(:PM, $$delete from public.item_corrections$$, 'aal2'),
  '42501', 'or delete it');
select is(pg_temp.scalar_as(:PM, 'select count(*) from public.item_corrections', 'aal2'), 1::bigint,
  'the manager reads corrections');
select is(pg_temp.scalar_as(:TX, 'select count(*) from public.item_corrections'), 0::bigint,
  'a teacher does not');
select is(pg_temp.scalar_as(:A, 'select count(*) from public.item_corrections'), 0::bigint,
  'a student reads no correction (they hold answer keys)');
select is(
  pg_temp.scalar_as(:A, format('select count(*) from public.activity_item_keys where item_id = %L', :ANSWERED)),
  0::bigint, 'and students still read no answer keys');

select * from finish();
rollback;
