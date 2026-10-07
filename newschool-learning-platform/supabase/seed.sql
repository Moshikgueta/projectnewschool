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
--   student D  student.d@example.com   Spanish L1 (group X)
--   teacher X  teacher.x@example.com   teaches groups X and W
--   teacher Y  teacher.y@example.com   teaches group Y
--   manager    manager@example.com     pedagogical manager (needs MFA for manager powers)
--   admin      admin@example.com       admin (needs MFA for admin powers)
--   office     office@example.com      school office: rooms and timetable (needs MFA)

-- ── accounts ────────────────────────────────────────────────────────────────
with people (id, email, display_name) as (
  values
    ('00000000-0000-4000-8000-0000000000a1'::uuid, 'student.a@example.com', 'Daniel (student A)'),
    ('00000000-0000-4000-8000-0000000000a2'::uuid, 'student.b@example.com', 'Maya (student B)'),
    ('00000000-0000-4000-8000-0000000000a3'::uuid, 'student.c@example.com', 'Noam (student C)'),
    ('00000000-0000-4000-8000-0000000000a4'::uuid, 'student.d@example.com', 'Lior (student D)'),
    ('00000000-0000-4000-8000-0000000000b1'::uuid, 'teacher.x@example.com', 'Teacher X'),
    ('00000000-0000-4000-8000-0000000000b2'::uuid, 'teacher.y@example.com', 'Teacher Y'),
    ('00000000-0000-4000-8000-0000000000c1'::uuid, 'manager@example.com', 'Pedagogical manager'),
    ('00000000-0000-4000-8000-0000000000d1'::uuid, 'admin@example.com', 'Office admin'),
    ('00000000-0000-4000-8000-0000000000e1'::uuid, 'office@example.com', 'School office (Rina)')
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
  ('00000000-0000-4000-8000-0000000000a4', 'student'),
  ('00000000-0000-4000-8000-0000000000b1', 'teacher'),
  ('00000000-0000-4000-8000-0000000000b2', 'teacher'),
  ('00000000-0000-4000-8000-0000000000c1', 'pedagogical_manager'),
  ('00000000-0000-4000-8000-0000000000d1', 'admin'),
  ('00000000-0000-4000-8000-0000000000e1', 'office');

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
   $json$[
     {"id":"b1","type":"heading","level":2,"text":"¡Hola! ¿Cómo te llamas?","lang":"es"},
     {"id":"b2","type":"text","text":"בפרק הזה נלמד **להציג את עצמנו** ולשאול אחרים לשמם.","lang":"he"},
     {"id":"skills","type":"cycleOverview","lang":"he","skills":[
       {"name":"להציג את עצמי","description":"לומר שם, גיל ומאיפה אני."},
       {"name":"לשאול שאלות","description":"לשאול מישהו לשמו."}]},
     {"id":"dialogue","type":"dialogue","lang":"es","lines":[
       {"speaker":"Ana","text":"¡Hola! Me llamo Ana. ¿Cómo te llamas?"},
       {"speaker":"Leo","text":"Me llamo Leo. ¡Mucho gusto!"}]},
     {"id":"vocab","type":"vocabulary","lang":"es","glossLang":"he","title":"Palabras","items":[
       {"term":"hola","gloss":"שלום"},{"term":"me llamo","gloss":"קוראים לי"},{"term":"mucho gusto","gloss":"נעים מאוד"}],
       "link":"https://quizlet.com/"},
     {"id":"tip","type":"callout","tone":"culture","lang":"he","title":"תרבות","text":"בספרד נוהגים לתת **שתי נשיקות** על הלחיים כשנפגשים."},
     {"id":"frame","type":"sentenceFrame","lang":"es","prompt":"Preséntate.","frame":"Me llamo ___ y soy de ___.","example":"Me llamo Ana y soy de Haifa."},
     {"id":"questions","type":"discussionQuestions","lang":"es","items":[
       {"question":"¿Cómo te llamas?","frame":"Me llamo ___."},
       {"question":"¿De dónde eres?","frame":"Soy de ___."}]},
     {"id":"tutor","type":"aiTutorPrompt","lang":"es","title":"Practica con Mori","message":"Hola Mori. Quiero practicar cómo presentarme en español, nivel 1."},
     {"id":"reflect","type":"reflection","lang":"he","prompt":"מה היה הכי קל בשיעור הזה?"}
   ]$json$, 'during_class', 'published'),
  ('60000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-000000000002', 1, 'La comida (draft)', '[]', 'during_class', 'draft'),
  ('60000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002',
   '40000000-0000-4000-8000-000000000003', 1, 'Bonjour !', '[]', 'during_class', 'published'),
  ('60000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000003',
   '40000000-0000-4000-8000-000000000004', 1, 'En la ciudad', '[]', 'during_class', 'published'),
  ('60000000-0000-4000-8000-000000000005', '50000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-000000000001', 1, 'Práctica: presentarse',
   $json$[
     {"id":"intro","type":"text","text":"Practise on your own. You can try each question again."},
     {"id":"ex","type":"activity","activityId":"70000000-0000-4000-8000-000000000006"}
   ]$json$, 'after_class', 'published');

insert into public.section_teacher_notes (section_id, course_id, blocks) values
  ('60000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
   $json$[
     {"id":"t0","anchor":null,"text":"Start with a name circle before opening the notebook.","minutes":5},
     {"id":"t1","anchor":"dialogue","text":"Read the dialogue twice, then have pairs swap names."},
     {"id":"t2","anchor":"questions","text":"Model one answer aloud before pairs ask each other.","minutes":10}
   ]$json$);

insert into public.activities (id, course_id, cycle_id, slug, title, phase, scoring_mode, est_minutes, status) values
  ('70000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
   'saludos-practica', 'Greetings practice', 'after_class', 'practice', 5, 'published'),
  ('70000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
   'saludos-borrador', 'Greetings (draft)', 'after_class', 'practice', 5, 'draft'),
  ('70000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000003',
   'salutations', 'Salutations', 'after_class', 'practice', 5, 'published'),
  ('70000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000004',
   'direcciones', 'Directions', 'after_class', 'practice', 5, 'published'),
  ('70000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
   'antes-de-clase', 'Before class: five greetings', 'before_class', 'none', 3, 'published'),
  ('70000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
   'saludos-completo', 'Greetings: every exercise type', 'after_class', 'practice', 8, 'published'),
  ('70000000-0000-4000-8000-000000000007', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
   'numeros', 'Numbers 1–10', 'after_class', 'practice', 5, 'published');

insert into public.activity_items (id, activity_id, course_id, position, type, prompt, data) values
  ('80000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 1,
   'multipleChoice', '[{"id":"p1","type":"text","text":"¿Cómo te llamas?","lang":"es"}]',
   '{"options":[{"id":"o1","text":"Me llamo Ana."},{"id":"o2","text":"Tengo diez años."}]}'),
  ('80000000-0000-4000-8000-000000000003', '70000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002', 1,
   'trueFalse', '[{"id":"p1","type":"text","text":"« Bonjour » se dit le matin.","lang":"fr"}]', '{}'),
  ('80000000-0000-4000-8000-000000000005', '70000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000001', 1,
   'reflection', '[{"id":"p1","type":"text","text":"¿Cómo saludas a tu profesor?","lang":"es"}]', '{}');

-- One item of every type (the player's E2E fixture). The public data carries
-- no answers: the right-hand column and the tokens are stored shuffled, and
-- their ids are numbered in display order so the ids don't pair up either.
insert into public.activity_items (id, activity_id, course_id, position, slug, type, prompt, data) values
  ('80000000-0000-4000-8000-000000000061', '70000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000001', 1, 'nombre',
   'multipleChoice', '[{"id":"p","type":"text","text":"¿Cómo te llamas?","lang":"es"}]',
   '{"options":[{"id":"o1","text":"Me llamo Ana."},{"id":"o2","text":"Tengo diez años."},{"id":"o3","text":"Soy de Haifa."}]}'),
  ('80000000-0000-4000-8000-000000000062', '70000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000001', 2, 'buenos-dias',
   'trueFalse', '[{"id":"p","type":"text","text":"«Buenos días» se dice por la mañana.","lang":"es"}]', '{}'),
  ('80000000-0000-4000-8000-000000000063', '70000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000001', 3, 'completa',
   'fillBlank', '[{"id":"p","type":"text","text":"Complete the sentences."}]',
   '{"text":"Me ___ Ana. ___, ¡hasta mañana!","wordBank":["llamo","Adiós"]}'),
  ('80000000-0000-4000-8000-000000000064', '70000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000001', 4, 'parejas',
   'matching', '[{"id":"p","type":"text","text":"Match the words with their meaning."}]',
   '{"left":[{"id":"l1","text":"hola"},{"id":"l2","text":"adiós"},{"id":"l3","text":"gracias"}],"right":[{"id":"r1","text":"thank you"},{"id":"r2","text":"hello"},{"id":"r3","text":"goodbye"}]}'),
  ('80000000-0000-4000-8000-000000000065', '70000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000001', 5, 'ordena',
   'reorderSentence', '[{"id":"p","type":"text","text":"Put the words in order."}]',
   '{"tokens":[{"id":"t1","text":"Ana."},{"id":"t2","text":"Me"},{"id":"t3","text":"llamo"}]}'),
  ('80000000-0000-4000-8000-000000000066', '70000000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000001', 6, 'saludo',
   'shortAnswer', '[{"id":"p","type":"text","text":"¿Cómo saludas a tu profesor?","lang":"es"}]', '{"maxLength":300}');

insert into public.activity_item_keys (item_id, course_id, answer, feedback) values
  ('80000000-0000-4000-8000-000000000061', '30000000-0000-4000-8000-000000000001', '{"optionIds":["o1"]}',
   '{"o2":"That says how old you are.","o3":"That says where you are from."}'),
  ('80000000-0000-4000-8000-000000000062', '30000000-0000-4000-8000-000000000001', '{"value":true}', '{}'),
  ('80000000-0000-4000-8000-000000000063', '30000000-0000-4000-8000-000000000001',
   '{"blanks":[{"accept":["llamo"]},{"accept":["Adiós","Chao"]}],"accents":"lenient"}', '{"incorrect":"Look at the word bank."}'),
  ('80000000-0000-4000-8000-000000000064', '30000000-0000-4000-8000-000000000001', '{"pairs":{"l1":"r2","l2":"r3","l3":"r1"}}', '{}'),
  ('80000000-0000-4000-8000-000000000065', '30000000-0000-4000-8000-000000000001', '{"accept":["Me llamo Ana."]}', '{}');

insert into public.activity_item_keys (item_id, course_id, answer, feedback) values
  ('80000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '{"optionIds":["o1"]}',
   '{"o2":"That answers how old you are."}'),
  ('80000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000002', '{"value":true}', '{}');

insert into public.skills (id, code, label) values
  ('90000000-0000-4000-8000-000000000001', 'vocab.greetings', 'Greetings vocabulary'),
  ('90000000-0000-4000-8000-000000000002', 'vocab.numbers', 'Numbers');
insert into public.activity_skills (activity_id, skill_id) values
  ('70000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001'),
  ('70000000-0000-4000-8000-000000000007', '90000000-0000-4000-8000-000000000002');

-- Progress fixture (Phase 5): "Numbers 1–10", which student A found hard.
insert into public.activity_items (id, activity_id, course_id, position, slug, type, prompt, data) values
  ('80000000-0000-4000-8000-000000000071', '70000000-0000-4000-8000-000000000007', '30000000-0000-4000-8000-000000000001', 1, 'dos-mas-tres',
   'multipleChoice', '[{"id":"p","type":"text","text":"Dos más tres son…","lang":"es"}]',
   '{"options":[{"id":"o1","text":"seis"},{"id":"o2","text":"cinco"},{"id":"o3","text":"cuatro"}]}'),
  ('80000000-0000-4000-8000-000000000072', '70000000-0000-4000-8000-000000000007', '30000000-0000-4000-8000-000000000001', 2, 'siete',
   'multipleChoice', '[{"id":"p","type":"text","text":"7"}]',
   '{"options":[{"id":"o1","text":"siete"},{"id":"o2","text":"setenta"},{"id":"o3","text":"seis"}]}'),
  ('80000000-0000-4000-8000-000000000073', '70000000-0000-4000-8000-000000000007', '30000000-0000-4000-8000-000000000001', 3, 'diez',
   'multipleChoice', '[{"id":"p","type":"text","text":"10"}]',
   '{"options":[{"id":"o1","text":"doce"},{"id":"o2","text":"dos"},{"id":"o3","text":"diez"}]}');
insert into public.activity_item_keys (item_id, course_id, answer, feedback) values
  ('80000000-0000-4000-8000-000000000071', '30000000-0000-4000-8000-000000000001', '{"optionIds":["o2"]}', '{}'),
  ('80000000-0000-4000-8000-000000000072', '30000000-0000-4000-8000-000000000001', '{"optionIds":["o1"]}', '{}'),
  ('80000000-0000-4000-8000-000000000073', '30000000-0000-4000-8000-000000000001', '{"optionIds":["o3"]}', '{}');

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
  ('a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a4'),
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

-- Student D did the homework too, and chose the same wrong answer as student B
-- first (teacher view: "common difficulties").
insert into public.attempts (id, user_id, activity_id, course_id, assignment_id, status, score, max_score, submitted_at) values
  ('c0000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-0000000000a4', '70000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'submitted', 0, 1, now());
insert into public.responses (attempt_id, user_id, course_id, item_id, answer, is_correct, score, try_no) values
  ('c0000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-0000000000a4', '30000000-0000-4000-8000-000000000001',
   '80000000-0000-4000-8000-000000000001', '{"optionIds":["o2"]}', false, 0, 1),
  ('c0000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-0000000000a4', '30000000-0000-4000-8000-000000000001',
   '80000000-0000-4000-8000-000000000001', '{"optionIds":["o1"]}', true, 1, 2);

-- Student A finished "Numbers 1–10" two days ago: 1 of 3 right on the first try.
insert into public.attempts (id, user_id, activity_id, course_id, status, score, max_score, started_at, updated_at, submitted_at) values
  ('c0000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000a1', '70000000-0000-4000-8000-000000000007',
   '30000000-0000-4000-8000-000000000001', 'submitted', 1, 3, now() - interval '2 days', now() - interval '2 days', now() - interval '2 days');
insert into public.responses (attempt_id, user_id, course_id, item_id, answer, is_correct, score, try_no, created_at) values
  ('c0000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000a1', '30000000-0000-4000-8000-000000000001',
   '80000000-0000-4000-8000-000000000071', '{"optionIds":["o1"]}', false, 0, 1, now() - interval '2 days'),
  ('c0000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000a1', '30000000-0000-4000-8000-000000000001',
   '80000000-0000-4000-8000-000000000071', '{"optionIds":["o2"]}', true, 1, 2, now() - interval '2 days'),
  ('c0000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000a1', '30000000-0000-4000-8000-000000000001',
   '80000000-0000-4000-8000-000000000072', '{"optionIds":["o1"]}', true, 1, 1, now() - interval '2 days'),
  ('c0000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000a1', '30000000-0000-4000-8000-000000000001',
   '80000000-0000-4000-8000-000000000073', '{"optionIds":["o1"]}', false, 0, 1, now() - interval '2 days');

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

-- Student B answered one in-class question (visible to teacher X, not to classmates).
insert into public.block_responses (user_id, section_id, course_id, block_id, item_index, answer) values
  ('00000000-0000-4000-8000-0000000000a2', '60000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001',
   'questions', 0, 'Me llamo Bea.');

insert into public.vocab_review_state (user_id, vocabulary_item_id, course_id, box) values
  ('00000000-0000-4000-8000-0000000000a1', '92000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 2),
  ('00000000-0000-4000-8000-0000000000a2', '92000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 1);

insert into public.learning_events (user_id, type, course_id, activity_id, occurred_at) values
  ('00000000-0000-4000-8000-0000000000a1', 'activity_completed', '30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000007', now() - interval '2 days');
insert into public.learning_events (user_id, type, course_id, activity_id) values
  ('00000000-0000-4000-8000-0000000000a1', 'activity_completed', '30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-0000000000a4', 'activity_completed', '30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-0000000000a2', 'activity_started', '30000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-0000000000a2', 'activity_completed', '30000000-0000-4000-8000-000000000002', '70000000-0000-4000-8000-000000000003');

-- Student A snoozed the vocabulary suggestion ("Not now"); B only opened it.
insert into public.recommendation_feedback (user_id, rec_key, action) values
  ('00000000-0000-4000-8000-0000000000a1', 'vocab-review:30000000-0000-4000-8000-000000000001', 'dismissed'),
  ('00000000-0000-4000-8000-0000000000a2', 'vocab-review:30000000-0000-4000-8000-000000000001', 'opened');

-- Group X's next class is in two days ("before class" suggestions). Two
-- earlier classes: two days ago, with attendance taken (A present, B late,
-- D absent), and nine days ago, attendance not taken yet.
insert into public.group_sessions (id, group_id, starts_at, cycle_id) values
  ('f0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', now() + interval '2 days', '40000000-0000-4000-8000-000000000001'),
  ('f0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', now() - interval '2 days', '40000000-0000-4000-8000-000000000001'),
  ('f0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', now() - interval '9 days', '40000000-0000-4000-8000-000000000001');
insert into public.attendance (session_id, student_id, status, marked_by) values
  ('f0000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a1', 'present', '00000000-0000-4000-8000-0000000000b1'),
  ('f0000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a2', 'late', '00000000-0000-4000-8000-0000000000b1'),
  ('f0000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a4', 'absent', '00000000-0000-4000-8000-0000000000b1');

-- ── rooms and the weekly timetable (from the staff room) ───────────────────
insert into public.rooms (id, name, capacity, kit, sort_order) values
  ('e0000000-0000-4000-8000-000000000001', 'Room 1', 12, 'Projector, whiteboard', 1),
  ('e0000000-0000-4000-8000-000000000002', 'Room 2', 8, 'Whiteboard', 2),
  ('e0000000-0000-4000-8000-000000000003', 'Zoom room', 0, 'Camera, headset', 3);

-- weekday 0 = Sunday; times in minutes from midnight (1080 = 18:00).
insert into public.room_bookings (id, room_id, title, group_id, teacher_id, weekday, start_min, end_min, note, created_by) values
  ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'Spanish Level 1 (group X)',
   'a0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000b1', 2, 1080, 1170, '',
   '00000000-0000-4000-8000-0000000000e1'),
  ('e1000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000002', 'French Level 1 (group Y)',
   'a0000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000b2', 4, 1140, 1230, '',
   '00000000-0000-4000-8000-0000000000e1'),
  ('e1000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000001', 'English Foundations',
   null, null, 0, 600, 690, 'Teacher to confirm', '00000000-0000-4000-8000-0000000000e1');

-- ── the office: contact details, packages, private lessons (stage D) ──────
-- Student A: 10-lesson package, paid; with teacher X: done a week ago,
-- cancelled late three days ago (counts), booked in three days → 2 used,
-- 1 booked, 7 left. Student B: 5-lesson package, not paid, expires in 10
-- days; with teacher Y: four done → 1 left (running low).
insert into public.student_records (student_id, phone, contact_email, office_note) values
  ('00000000-0000-4000-8000-0000000000a1', '050-1234567', '', 'Prefers evenings'),
  ('00000000-0000-4000-8000-0000000000a2', '052-7654321', 'maya.family@example.com', '');
insert into public.lesson_packages (id, student_id, lessons, minutes_per_lesson, starts_on, expires_on, price, paid_at, created_by) values
  ('d0000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', 10, 60,
   current_date - 30, current_date + 120, 1800, now() - interval '30 days', '00000000-0000-4000-8000-0000000000e1'),
  ('d0000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a2', 5, 45,
   current_date - 60, current_date + 10, 950, null, '00000000-0000-4000-8000-0000000000e1');
insert into public.private_lessons (id, student_id, teacher_id, package_id, starts_at, ends_at, status, cancelled_at, created_by) values
  ('d1000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1',
   'd0000000-0000-4000-8000-000000000001', now() - interval '7 days', now() - interval '7 days' + interval '1 hour', 'done', null, '00000000-0000-4000-8000-0000000000e1'),
  ('d1000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1',
   'd0000000-0000-4000-8000-000000000001', now() - interval '3 days', now() - interval '3 days' + interval '1 hour', 'cancelled_late', now() - interval '3 days' - interval '2 hours', '00000000-0000-4000-8000-0000000000e1'),
  ('d1000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1',
   'd0000000-0000-4000-8000-000000000001', now() + interval '3 days', now() + interval '3 days' + interval '1 hour', 'scheduled', null, '00000000-0000-4000-8000-0000000000e1'),
  ('d1000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000b2',
   'd0000000-0000-4000-8000-000000000002', now() - interval '28 days', now() - interval '28 days' + interval '45 minutes', 'done', null, '00000000-0000-4000-8000-0000000000e1'),
  ('d1000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000b2',
   'd0000000-0000-4000-8000-000000000002', now() - interval '21 days', now() - interval '21 days' + interval '45 minutes', 'done', null, '00000000-0000-4000-8000-0000000000e1'),
  ('d1000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000b2',
   'd0000000-0000-4000-8000-000000000002', now() - interval '14 days', now() - interval '14 days' + interval '45 minutes', 'done', null, '00000000-0000-4000-8000-0000000000e1'),
  ('d1000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000b2',
   'd0000000-0000-4000-8000-000000000002', now() - interval '7 days', now() - interval '7 days' + interval '45 minutes', 'done', null, '00000000-0000-4000-8000-0000000000e1');

-- ── staff tools (stage E) ─────────────────────────────────────────────────
-- Training links from the staff room's training-meeting list; one piece of
-- feedback from teacher X about student D; one task for the manager from
-- teacher X.
insert into public.staff_resources (id, title, url, description, created_by) values
  ('d2000000-0000-4000-8000-000000000001', 'מדריך המורה — שיטת הסייקלים של New School', 'https://drive.google.com/drive/search?q=%D7%9E%D7%93%D7%A8%D7%99%D7%9A', 'חובה לפני פגישה 1', '00000000-0000-4000-8000-0000000000c1'),
  ('d2000000-0000-4000-8000-000000000002', 'איך עובדים עם המחברת הדיגיטלית', 'https://drive.google.com/drive/search?q=%D7%9E%D7%97%D7%91%D7%A8%D7%AA', 'פגישה 1', '00000000-0000-4000-8000-0000000000c1'),
  ('d2000000-0000-4000-8000-000000000003', 'הערכת רמה לפי CEFR — סרגל אחיד', 'https://drive.google.com/drive/search?q=CEFR', 'פגישה 2', '00000000-0000-4000-8000-0000000000c1');
insert into public.staff_feedback (id, author_id, kind, student_id, verdict, body) values
  ('d3000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000b1', 'student',
   '00000000-0000-4000-8000-0000000000a4', 'needs_attention', 'Missed two classes and is behind on the cycle.');
insert into public.staff_feedback (id, author_id, kind, subject, language_code, level, body) values
  ('d3000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000b2', 'missing_material',
   'listening', 'fr', 1, 'Nothing for listening practice at level 1.');
insert into public.staff_tasks (id, title, priority, created_by, assignee_id) values
  ('d4000000-0000-4000-8000-000000000001', 'Approve the new Russian level notebook', 'normal',
   '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000c1');
