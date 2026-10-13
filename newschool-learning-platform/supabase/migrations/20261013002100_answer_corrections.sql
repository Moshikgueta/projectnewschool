-- Correcting the answer key of an answered question (owner decision
-- 2026-10-13, ADR-041).
--
-- During the pilot students report mistakes. A question students have
-- answered keeps its options and answer key (ADR-036, triggers
-- app.protect_answered_item / app.protect_answered_key). The owner decided:
-- "let the pedagogical manager correct the answer, and the system
-- automatically re-checks past answers, so students who answered correctly
-- get credit."
--
-- How it works
--   1. The manager (MFA) inserts a row into public.item_corrections with their
--      own session: the item, its new answer key (and its data, of which only
--      multiple choice's `multiple` flag may change), the authored form of the
--      corrected question for the editor's source, and a reason. Nothing in
--      public is callable as RPC: the insert is the request.
--   2. The BEFORE INSERT trigger app.correct_answered_item() (SECURITY DEFINER)
--      checks app.is_manager() itself, records the old data and key, and
--      applies the correction to activity_items, activity_item_keys and
--      activity_sources in the same transaction. All or nothing.
--   3. Re-checking past answers is done by the server (grading is TypeScript,
--      ADR-006; one grader for live answers and corrections): the Server
--      Action, after its own manager check, re-grades every response of the
--      item with the privileged module and recomputes the attempts' state and
--      score, then records the counts here. It is idempotent: running it again
--      changes nothing more.
--
-- The answered-item triggers let the correction through only while the
-- function runs: it writes a one-time token for this transaction and this
-- item into app.item_correction_grants (a table no API role can read or
-- write) and sets the transaction-local setting app.item_correction to that
-- token. The triggers ask app.item_correction_allowed(item), which needs
-- BOTH a grant row for the current transaction id and that item AND the
-- setting to equal its token. Any session can set a custom setting, but no
-- API role can create the grant row, so setting app.item_correction alone
-- bypasses nothing (pgTAP 17_answer_corrections). The grant is removed before
-- the function returns.

-- ── when a question was corrected (students may see the date) ─────────────
alter table public.activity_items add column corrected_at timestamptz;
comment on column public.activity_items.corrected_at is
  'When the answer key was last corrected after students had answered (ADR-041). Set only by app.correct_answered_item().';

-- ── the bypass, for the correction function only ──────────────────────────
create table app.item_correction_grants (
  txid bigint not null,
  item_id uuid not null,
  token uuid not null,
  primary key (txid, item_id)
);
revoke all on app.item_correction_grants from public, anon, authenticated, service_role;

/** Whether the running transaction is the correction function correcting this item. */
create function app.item_correction_allowed(p_item uuid)
returns boolean language sql volatile security definer set search_path = '' as $$
  select exists (
    select 1 from app.item_correction_grants g
    where g.txid = txid_current()
      and g.item_id = p_item
      and g.token::text = coalesce(current_setting('app.item_correction', true), '')
  );
$$;
revoke all on function app.item_correction_allowed(uuid) from public, anon;
grant execute on function app.item_correction_allowed(uuid) to authenticated, service_role;

-- The answered-item rules of ADR-036, unchanged except for the correction.
create or replace function app.protect_answered_item()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if app.item_has_answers(old.id) then
      raise exception 'item % has answers and cannot be removed', old.slug using errcode = '23001';
    end if;
    return old;
  end if;
  if new.corrected_at is distinct from old.corrected_at
     and not app.item_correction_allowed(old.id) then
    raise exception 'corrected_at is set by an answer correction only' using errcode = '23001';
  end if;
  if (new.type is distinct from old.type or new.data is distinct from old.data)
     and app.item_has_answers(old.id)
     and not app.item_correction_allowed(old.id) then
    raise exception 'item % has answers: its options cannot change', old.slug using errcode = '23001';
  end if;
  return new;
end;
$$;

create or replace function app.protect_answered_key()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    -- Removing the item itself (cascade) is checked on the item.
    if app.item_has_answers(old.item_id)
       and exists (select 1 from public.activity_items where id = old.item_id) then
      raise exception 'the answers of an answered item cannot be removed' using errcode = '23001';
    end if;
    return old;
  end if;
  if new.answer is distinct from old.answer
     and app.item_has_answers(old.item_id)
     and not app.item_correction_allowed(old.item_id) then
    raise exception 'the answers of an answered item cannot change' using errcode = '23001';
  end if;
  return new;
end;
$$;

-- A new item never arrives already "corrected".
create or replace function app.activity_items_slug()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.slug is null then
    new.slug := 'item-' || left(replace(new.id::text, '-', ''), 12);
  end if;
  new.corrected_at := null;
  return new;
end;
$$;

-- ── the corrections: request and audit record in one ──────────────────────
create table public.item_corrections (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null,
  course_id uuid not null,
  -- Set by the trigger (from the item, the caller and the clock).
  activity_id uuid,
  corrected_by uuid references public.profiles (id) on delete set null,
  corrected_at timestamptz not null default now(),
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  -- The mistake report this correction answers, if any.
  report_id uuid references public.content_reports (id) on delete set null,
  old_data jsonb,
  old_answer jsonb,
  new_data jsonb not null check (jsonb_typeof(new_data) = 'object'),
  new_answer jsonb not null check (jsonb_typeof(new_answer) = 'object'),
  -- The corrected question in the authored form (activity_sources), if the
  -- exercise has a saved source.
  new_source jsonb check (new_source is null or jsonb_typeof(new_source) = 'object'),
  -- Filled in by the server's re-check of past answers (null until it ran).
  responses_rechecked int check (responses_rechecked >= 0),
  became_correct int check (became_correct >= 0),
  became_incorrect int check (became_incorrect >= 0),
  attempts_rescored int check (attempts_rescored >= 0),
  regraded_at timestamptz,
  foreign key (item_id, course_id) references public.activity_items (id, course_id) on delete cascade
);
create index item_corrections_item_idx on public.item_corrections (item_id, corrected_at desc);
create index item_corrections_course_idx on public.item_corrections (item_id, course_id);
create index item_corrections_report_idx on public.item_corrections (report_id) where report_id is not null;
create index item_corrections_by_idx on public.item_corrections (corrected_by) where corrected_by is not null;

comment on table public.item_corrections is
  'Answer-key corrections of answered questions (ADR-041): the request (inserted by the pedagogical manager with MFA) and its audit record. Holds answer keys: manager only.';

create function app.correct_answered_item()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_item public.activity_items%rowtype;
  v_old_answer jsonb;
  v_token uuid := gen_random_uuid();
begin
  -- Checked here, not only by the insert policy: this function writes with
  -- its owner's rights.
  if not app.is_manager() then
    raise exception 'only the pedagogical manager (MFA) corrects answers' using errcode = '42501';
  end if;

  select * into v_item from public.activity_items
   where id = new.item_id and course_id = new.course_id
   for update;
  if not found then
    raise exception 'no such question' using errcode = '23503';
  end if;
  select answer into v_old_answer from public.activity_item_keys
   where item_id = new.item_id
   for update;
  if not found then
    raise exception 'question % has no answer key to correct', v_item.slug using errcode = '22023';
  end if;

  -- Past answers must keep their meaning: the options, words and pairs stay
  -- (with their ids); only multiple choice's "several answers" flag may follow
  -- the new key.
  if (new.new_data - 'multiple') is distinct from (v_item.data - 'multiple') then
    raise exception 'a correction changes the answer key, not the options of %', v_item.slug
      using errcode = '23001';
  end if;
  if new.new_answer = v_old_answer and new.new_data = v_item.data then
    raise exception 'the correction does not change question %', v_item.slug using errcode = '22023';
  end if;
  if new.new_source is not null and (
       new.new_source ->> 'id' is distinct from v_item.slug
       or new.new_source ->> 'type' is distinct from v_item.type) then
    raise exception 'the corrected source is not question %', v_item.slug using errcode = '22023';
  end if;

  new.activity_id := v_item.activity_id;
  new.corrected_by := (select auth.uid());
  new.corrected_at := now();
  new.old_data := v_item.data;
  new.old_answer := v_old_answer;
  new.responses_rechecked := null;
  new.became_correct := null;
  new.became_incorrect := null;
  new.attempts_rescored := null;
  new.regraded_at := null;

  -- Open the answered-item rule for this item, in this transaction only.
  insert into app.item_correction_grants (txid, item_id, token)
  values (txid_current(), v_item.id, v_token);
  perform set_config('app.item_correction', v_token::text, true);

  update public.activity_items
     set data = new.new_data, corrected_at = new.corrected_at
   where id = v_item.id;
  update public.activity_item_keys
     set answer = new.new_answer
   where item_id = v_item.id;

  -- Close it again.
  delete from app.item_correction_grants where txid = txid_current() and item_id = v_item.id;
  perform set_config('app.item_correction', '', true);

  -- The editor's authored source shows the corrected answer.
  if new.new_source is not null then
    update public.activity_sources s
       set source = jsonb_set(
             s.source, '{items}',
             coalesce((
               select jsonb_agg(case when e ->> 'id' = v_item.slug then new.new_source else e end
                                order by ord)
                 from jsonb_array_elements(s.source -> 'items') with ordinality as t (e, ord)
             ), '[]'::jsonb))
     where s.activity_id = v_item.activity_id
       and jsonb_typeof(s.source -> 'items') = 'array';
  end if;

  -- An editor opened before the correction must reload before saving.
  update public.activities set updated_at = now() where id = v_item.activity_id;
  return new;
end;
$$;
revoke all on function app.correct_answered_item() from public, anon, authenticated, service_role;

create trigger item_corrections_apply before insert on public.item_corrections
  for each row execute function app.correct_answered_item();

-- A correction is a record: afterwards only the re-check's counts are filled
-- in (by the server, with the secret key). Nobody deletes one.
create function app.item_corrections_keep()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.id, new.item_id, new.course_id, new.activity_id, new.corrected_by, new.corrected_at,
      new.reason, new.old_data, new.old_answer, new.new_data, new.new_answer, new.new_source)
     is distinct from
     (old.id, old.item_id, old.course_id, old.activity_id, old.corrected_by, old.corrected_at,
      old.reason, old.old_data, old.old_answer, old.new_data, old.new_answer, old.new_source) then
    raise exception 'a correction cannot be changed' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.item_corrections_keep() from public, anon;
create trigger item_corrections_keep before update on public.item_corrections
  for each row execute function app.item_corrections_keep();

-- ── access ─────────────────────────────────────────────────────────────────
alter table public.item_corrections enable row level security;
alter table public.item_corrections force row level security;

revoke all on public.item_corrections from public, anon, authenticated;
grant select on public.item_corrections to authenticated;
grant insert (item_id, course_id, reason, report_id, new_data, new_answer, new_source)
  on public.item_corrections to authenticated;
grant select, insert, update on public.item_corrections to service_role;

-- Corrections hold answer keys: the pedagogical manager (MFA) only.
create policy item_corrections_select on public.item_corrections for select to authenticated
  using ((select app.is_manager()));
create policy item_corrections_insert on public.item_corrections for insert to authenticated
  with check ((select app.is_manager()));
