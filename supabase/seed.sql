-- Seed data for LOCAL and STAGING only. Never run against production.
--
-- These fixtures are what the authorization tests attack. Every person here is
-- fictional; every account shares one local-only password:
--
--     Local-dev-password-1
--
--   student A  student.a@example.com   Spanish L1 (group X) + Spanish L2 (group W, draft course)
--   student B  student.b@example.com   Spanish L1 (group X) + French L1 (group Y)
--   student C  student.c@example.com   French L1 (group Y)
--   teacher X  teacher.x@example.com   teaches groups X and W
--   teacher Y  teacher.y@example.com   teaches group Y
--   manager    manager@example.com     pedagogical manager (needs MFA for manager powers)
--   admin      admin@example.com       admin (needs MFA for admin powers)

-- ── accounts ────────────────────────────────────────────────────────────────
with people (id, email, display_name) as (
  values
    ('00000000-0000-4000-8000-0000000000a1'::uuid, 'student.a@example.com', 'Daniel (student A)'),
    ('00000000-0000-4000-8000-0000000000a2'::uuid, 'student.b@example.com', 'Maya (student B)'),
    ('00000000-0000-4000-8000-0000000000a3'::uuid, 'student.c@example.com', 'Noam (student C)'),
    ('00000000-0000-4000-8000-0000000000b1'::uuid, 'teacher.x@example.com', 'Teacher X'),
    ('00000000-0000-4000-8000-0000000000b2'::uuid, 'teacher.y@example.com', 'Teacher Y'),
    ('00000000-0000-4000-8000-0000000000c1'::uuid, 'manager@example.com', 'Pedagogical manager'),
    ('00000000-0000-4000-8000-0000000000d1'::uuid, 'admin@example.com', 'Office admin')
),
new_users as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  )
  select
    '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
    extensions.crypt('Local-dev-password-1', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', jsonb_build_object('display_name', display_name),
    now(), now(), '', '', '', '', '', '', '', ''
  from people
  returning id, email
)
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text,
       jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true),
       'email', now(), now(), now()
from new_users;

insert into public.user_roles (user_id, role) values
  ('00000000-0000-4000-8000-0000000000a1', 'student'),
  ('00000000-0000-4000-8000-0000000000a2', 'student'),
  ('00000000-0000-4000-8000-0000000000a3', 'student'),
  ('00000000-0000-4000-8000-0000000000b1', 'teacher'),
  ('00000000-0000-4000-8000-0000000000b2', 'teacher'),
  ('00000000-0000-4000-8000-0000000000c1', 'pedagogical_manager'),
  ('00000000-0000-4000-8000-0000000000d1', 'admin');

-- ── catalog ─────────────────────────────────────────────────────────────────
insert into public.languages (id, code, name, direction) values
  ('10000000-0000-4000-8000-000000000001', 'es', 'Spanish', 'ltr'),
  ('10000000-0000-4000-8000-000000000002', 'fr', 'French', 'ltr');

insert into public.levels (id, language_id, code, title, position, cefr) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'level-1', 'Level 1', 1, 'A1'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'level-2', 'Level 2', 2, 'A2'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', 'level-1', 'Level 1', 1, 'A1');

insert into public.courses (id, level_id, slug, title, description, instruction_locale, status, published_at) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'espanol-basico-pilot',
   'Español básico (fixture)', 'Local test course', 'he', 'published', now()),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003', 'francais-niveau-1-pilot',
   'Français niveau 1 (fixture)', 'Local test course', 'he', 'published', now()),
  ('30000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', 'espanol-nivel-2-draft',
   'Español nivel 2 (draft fixture)', 'Unpublished test course', 'he', 'draft', null);

insert into public.cycles (id, course_id, slug, title, communicative_goal, position, status) values
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'presentarse', 'Introducing yourself', 'Greet people and say who you are', 1, 'published'),
  ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'la-comida', 'Food', 'Talk about what you like to eat', 2, 'draft'),
  ('40000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002', 'se-presenter', 'Introducing yourself', 'Greet people and say who you are', 1, 'published'),
  ('40000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000003', 'en-la-ciudad', 'The city', 'Find your way around', 1, 'published');

insert into public.books (id, course_id, kind, title) values
  ('50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'notebook', 'Cuaderno digital'),
  ('50000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', 'workbook', 'Cuaderno de ejercicios'),
  ('50000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002', 'notebook', 'Cahier digital'),
  ('50000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000003', 'notebook', 'Cuaderno nivel 2');

insert into public.book_sections (id, book_id, course_id, cycle_id, position, title, blocks, phase, status) values
  ('60000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-000000000001', 1, '¡Hola!',
   '[{"id":"b1","type":"heading","level":2,"text":"¡Hola! ¿Cómo te llamas?","lang":"es"},
     {"id":"b2","type":"text","text":"בפרק הזה נלמד להציג את עצמנו.","lang":"he"}]', 'during_class', 'published'),
  ('60000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-000000000002', 1, 'La comida (draft)', '[]', 'during_class', 'draft'),
  ('60000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002',
   '40000000-0000-4000-8000-000000000003', 1, 'Bonjour !', '[]', 'during_class', 'published'),
  ('60000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000003',
   '40000000-0000-4000-8000-000000000004', 1, 'En la ciudad', '[]', 'during_class', 'published');

insert into public.section_teacher_notes (section_id, course_id, blocks) values
  ('60000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
   '[{"id":"t1","type":"teacherTip","text":"Start with a name circle before opening the notebook."}]');

insert into public.activities (id, course_id, cycle_id, slug, title, phase, scoring_mode, est_minutes, status) values
  ('70000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
   'saludos-practica', 'Greetings practice', 'after_class', 'practice', 5, 'published'),
  ('70000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
   'saludos-borrador', 'Greetings (draft)', 'after_class', 'practice', 5, 'draft'),
  ('70000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000003',
   'salutations', 'Salutations', 'after_class', 'practice', 5, 'published'),
  ('70000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000004',
   'direcciones', 'Directions', 'after_class', 'practice', 5, 'published');

insert into public.activity_items (id, activity_id, course_id, position, type, prompt, data) values
  ('80000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 1,
   'multipleChoice', '[{"id":"p1","type":"text","text":"¿Cómo te llamas?","lang":"es"}]',
   '{"options":[{"id":"o1","text":"Me llamo Ana."},{"id":"o2","text":"Tengo diez años."}]}'),
  ('80000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002', 1,
   'trueFalse', '[{"id":"p1","type":"text","text":"« Bonjour » se dit le matin.","lang":"fr"}]', '{}');

insert into public.activity_item_keys (item_id, course_id, answer, feedback) values
  ('80000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '{"optionIds":["o1"]}',
   '{"o2":"That answers how old you are."}'),
  ('80000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002', '{"value":true}', '{}');

insert into public.skills (id, code, label) values
  ('90000000-0000-4000-8000-000000000001', 'vocab.greetings', 'Greetings vocabulary');
insert into public.activity_skills (activity_id, skill_id) values
  ('70000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001');

insert into public.vocabulary_sets (id, course_id, cycle_id, title, status) values
  ('91000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'Saludos', 'published');
insert into public.vocabulary_items (id, set_id, course_id, position, term, gloss) values
  ('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 1, 'hola', 'שלום'),
  ('92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 2, 'adiós', 'להתראות');

-- ── delivery ────────────────────────────────────────────────────────────────
insert into public.groups (id, course_id, name, status, schedule_note) values
  ('a0000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Spanish Level 1 · Tuesday (group X)', 'active', 'Tuesdays 18:00'),
  ('a0000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'French Level 1 · Thursday (group Y)', 'active', 'Thursdays 19:00'),
  ('a0000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', 'Spanish Level 2 · draft course (group W)', 'planned', '');

insert into public.group_teachers (group_id, teacher_id, role) values
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000b1', 'lead'),
  ('a0000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000b1', 'lead'),
  ('a0000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000b2', 'lead');

insert into public.enrollments (group_id, student_id) values
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1'),
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a2'),
  ('a0000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a2'),
  ('a0000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a3'),
  ('a0000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000a1');

insert into public.group_cycles (group_id, cycle_id, course_id, state, position, activated_at) values
  ('a0000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'active', 1, now()),
  ('a0000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002', 'active', 1, now());

insert into public.assignments (id, group_id, course_id, activity_id, audience, phase, due_at, note, assigned_by) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
   '70000000-0000-4000-8000-000000000001', 'group', 'after_class', now() + interval '3 days', 'Before Tuesday', '00000000-0000-4000-8000-0000000000b1'),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002',
   '70000000-0000-4000-8000-000000000003', 'group', 'after_class', now() + interval '5 days', '', '00000000-0000-4000-8000-0000000000b2');

-- ── learner records ─────────────────────────────────────────────────────────
insert into public.attempts (id, user_id, activity_id, course_id, assignment_id, status, score, max_score, submitted_at) values
  ('c0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', '70000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'submitted', 1, 1, now()),
  ('c0000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a2', '70000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'in_progress', null, null, null),
  ('c0000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000a2', '70000000-0000-4000-8000-000000000003',
   '30000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'submitted', 0, 1, now()),
  ('c0000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000a3', '70000000-0000-4000-8000-000000000003',
   '30000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000002', 'submitted', 1, 1, now());

insert into public.responses (attempt_id, user_id, course_id, item_id, answer, is_correct, score) values
  ('c0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', '30000000-0000-4000-8000-000000000001',
   '80000000-0000-4000-8000-000000000001', '{"optionIds":["o1"]}', true, 1),
  ('c0000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a2', '30000000-0000-4000-8000-000000000001',
   '80000000-0000-4000-8000-000000000001', '{"optionIds":["o2"]}', false, 0),
  ('c0000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000a2', '30000000-0000-4000-8000-000000000002',
   '80000000-0000-4000-8000-000000000003', '{"value":false}', false, 0),
  ('c0000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000a3', '30000000-0000-4000-8000-000000000002',
   '80000000-0000-4000-8000-000000000003', '{"value":true}', true, 1);

insert into public.section_progress (user_id, book_section_id, course_id, status, last_block_id) values
  ('00000000-0000-4000-8000-0000000000a1', '60000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'in_progress', 'b2'),
  ('00000000-0000-4000-8000-0000000000a2', '60000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'completed', 'b2');

insert into public.vocab_review_state (user_id, vocabulary_item_id, course_id, box) values
  ('00000000-0000-4000-8000-0000000000a1', '92000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 2),
  ('00000000-0000-4000-8000-0000000000a2', '92000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 1);

insert into public.learning_events (user_id, type, course_id, activity_id) values
  ('00000000-0000-4000-8000-0000000000a1', 'activity_completed', '30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-0000000000a2', 'activity_started', '30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-0000000000a2', 'activity_completed', '30000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000003');

insert into public.recommendation_feedback (user_id, rec_key, action) values
  ('00000000-0000-4000-8000-0000000000a1', 'vocab-review:91000000-0000-4000-8000-000000000001', 'dismissed'),
  ('00000000-0000-4000-8000-0000000000a2', 'vocab-review:91000000-0000-4000-8000-000000000001', 'opened');
