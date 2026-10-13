-- Exercise editing in the platform (Phase 8, ADR-036).
--
-- 1. The exercise as its author wrote it (options in their own order, the
--    right answers marked) is kept in activity_sources, readable by the
--    pedagogical manager only. Stored items are shuffled for students
--    (ADR-024); compiling the same source again gives the same items, so an
--    edit changes only what was edited.
-- 2. Pedagogical managers (MFA) write exercises, items and answer keys with
--    their own session.
-- 3. Students' answers are protected: an item somebody has answered cannot
--    lose its options or change its answers, and cannot be deleted (which
--    would also delete the answers). Its wording, feedback and points can
--    still change. This holds for the import script too.

create table public.activity_sources (
  activity_id uuid primary key,
  course_id uuid not null,
  source jsonb not null check (jsonb_typeof(source) = 'object'),
  updated_at timestamptz not null default now(),
  foreign key (activity_id, course_id) references public.activities (id, course_id) on delete cascade
);
create trigger activity_sources_touch before update on public.activity_sources
  for each row execute function app.touch_updated_at();

alter table public.activity_sources enable row level security;
alter table public.activity_sources force row level security;
grant select, insert, update on public.activity_sources to authenticated;
grant all on public.activity_sources to service_role;

create policy activity_sources_select on public.activity_sources for select to authenticated
  using ((select app.is_manager()));
create policy activity_sources_insert on public.activity_sources for insert to authenticated
  with check ((select app.is_manager()));
create policy activity_sources_update on public.activity_sources for update to authenticated
  using ((select app.is_manager())) with check ((select app.is_manager()));

create policy activities_insert on public.activities for insert to authenticated
  with check ((select app.is_manager()));
create policy activity_items_insert on public.activity_items for insert to authenticated
  with check ((select app.is_manager()));
create policy activity_items_update on public.activity_items for update to authenticated
  using ((select app.is_manager())) with check ((select app.is_manager()));
create policy activity_items_delete on public.activity_items for delete to authenticated
  using ((select app.is_manager()));
create policy activity_item_keys_insert on public.activity_item_keys for insert to authenticated
  with check ((select app.is_manager()));
create policy activity_item_keys_update on public.activity_item_keys for update to authenticated
  using ((select app.is_manager())) with check ((select app.is_manager()));
create policy activity_item_keys_delete on public.activity_item_keys for delete to authenticated
  using ((select app.is_manager()));

/** Whether any student has answered this item. */
create function app.item_has_answers(p_item uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.responses where item_id = p_item);
$$;
revoke all on function app.item_has_answers(uuid) from public;
grant execute on function app.item_has_answers(uuid) to authenticated, service_role;

create function app.protect_answered_item()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if app.item_has_answers(old.id) then
      raise exception 'item % has answers and cannot be removed', old.slug using errcode = '23001';
    end if;
    return old;
  end if;
  if (new.type is distinct from old.type or new.data is distinct from old.data)
     and app.item_has_answers(old.id) then
    raise exception 'item % has answers: its options cannot change', old.slug using errcode = '23001';
  end if;
  return new;
end;
$$;
revoke all on function app.protect_answered_item() from public;
create trigger activity_items_protect_answered before update or delete on public.activity_items
  for each row execute function app.protect_answered_item();

create function app.protect_answered_key()
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
  if new.answer is distinct from old.answer and app.item_has_answers(old.item_id) then
    raise exception 'the answers of an answered item cannot change' using errcode = '23001';
  end if;
  return new;
end;
$$;
revoke all on function app.protect_answered_key() from public;
create trigger activity_item_keys_protect_answered before update or delete on public.activity_item_keys
  for each row execute function app.protect_answered_key();

-- Every change to an exercise's items and answers is in the audit log.
create trigger audit_activity_items after insert or update or delete on public.activity_items
  for each row execute function app.audit_row();
create trigger audit_activity_sources after insert or update on public.activity_sources
  for each row execute function app.audit_row();

-- Every item has a slug (the editor and the import match items by it).
-- Items written without one get "item-" and the start of their id.
create function app.activity_items_slug()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.slug is null then
    new.slug := 'item-' || left(replace(new.id::text, '-', ''), 12);
  end if;
  return new;
end;
$$;
revoke all on function app.activity_items_slug() from public;
create trigger activity_items_slug before insert on public.activity_items
  for each row execute function app.activity_items_slug();
update public.activity_items set slug = 'item-' || left(replace(id::text, '-', ''), 12) where slug is null;
alter table public.activity_items alter column slug set not null;
