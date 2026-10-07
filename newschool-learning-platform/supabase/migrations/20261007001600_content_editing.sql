-- Content editing in the platform (Phase 8, first part; ADR-034). Until now
-- content reached the database only through `pnpm content:import` with the
-- secret key: no user session could write it. Pedagogical managers (with
-- MFA) now edit courses, cycles, books and sections, and change the status
-- of activities, with their own session. Nothing is deleted from the editor:
-- content is archived instead, so learner records keep what they point to.

create policy courses_insert on public.courses for insert to authenticated
  with check ((select app.is_manager()));
create policy courses_update on public.courses for update to authenticated
  using ((select app.is_manager())) with check ((select app.is_manager()));

create policy cycles_insert on public.cycles for insert to authenticated
  with check ((select app.is_manager()));
create policy cycles_update on public.cycles for update to authenticated
  using ((select app.is_manager())) with check ((select app.is_manager()));

create policy books_insert on public.books for insert to authenticated
  with check ((select app.is_manager()));
create policy books_update on public.books for update to authenticated
  using ((select app.is_manager())) with check ((select app.is_manager()));

create policy book_sections_insert on public.book_sections for insert to authenticated
  with check ((select app.is_manager()));
create policy book_sections_update on public.book_sections for update to authenticated
  using ((select app.is_manager())) with check ((select app.is_manager()));

create policy section_teacher_notes_insert on public.section_teacher_notes for insert to authenticated
  with check ((select app.is_manager()));
create policy section_teacher_notes_update on public.section_teacher_notes for update to authenticated
  using ((select app.is_manager())) with check ((select app.is_manager()));

create policy activities_update on public.activities for update to authenticated
  using ((select app.is_manager())) with check ((select app.is_manager()));

-- When a section was last changed in the editor. `pnpm content:import`
-- leaves such sections alone (unless told to overwrite them), so a later
-- import of an older content file cannot silently undo work done here.
alter table public.book_sections add column edited_in_app_at timestamptz;

-- Deletes stay with the import script (and the database's own cascades).
revoke delete on public.courses, public.cycles, public.books, public.book_sections,
  public.section_teacher_notes from authenticated;

-- A course gets its publication date the first time it is published.
create function app.courses_published_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;
revoke all on function app.courses_published_at() from public;
create trigger courses_published_at before insert or update of status on public.courses
  for each row execute function app.courses_published_at();

-- Rows keyed by section_id (teacher notes) are named by it in the log.
create or replace function app.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
  values (
    auth.uid(),
    tg_op,
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'section_id',
      concat_ws(':', v_row ->> 'user_id', v_row ->> 'role', v_row ->> 'group_id', v_row ->> 'teacher_id')),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

-- History: every change to a section's content or notes is in the audit log
-- (before and after), not only status changes.
create trigger audit_book_sections_content after update of title, phase, position, blocks
  on public.book_sections for each row execute function app.audit_row();
create trigger audit_section_teacher_notes after insert or update or delete
  on public.section_teacher_notes for each row execute function app.audit_row();
