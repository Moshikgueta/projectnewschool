-- A made-up staff room, in the shape `wrangler d1 export` writes. Every person,
-- address and hash here is invented (local tests only).
PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE staff_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  username TEXT UNIQUE,          -- optional short handle ('yotam'); login accepts either
  pass_hash TEXT NOT NULL,       -- pbkdf2$<iterations>$<saltHex>$<hashHex>
  role TEXT NOT NULL,            -- מורה | מנהל פדגוגי | אדמין | מנהלת קבלה | תלמיד
  name TEXT NOT NULL,
  initials TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,      -- 0 = disabled, or self-signup awaiting approval
  must_change INTEGER NOT NULL DEFAULT 0, -- 1 after an admin issues a temporary password
  screens TEXT,                  -- JSON array of screen keys; NULL = every screen
  student_id TEXT,               -- links a תלמיד account to its student record
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE staff_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES staff_users(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE staff_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES staff_users(id),
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE student_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES staff_users(id),
  issued_by TEXT,                -- staff_users.id of whoever pressed the button
  created_at INTEGER NOT NULL
);
CREATE TABLE code_attempts (
  scope TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  n INTEGER NOT NULL
);
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,     -- 'כיתה 2'
  capacity INTEGER NOT NULL DEFAULT 0,   -- 0 = unstated
  kit TEXT NOT NULL DEFAULT '',  -- projector, whiteboard, floor — free text on purpose
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE room_bookings (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  title TEXT NOT NULL,           -- 'English Foundations'
  teacher TEXT NOT NULL DEFAULT '',
  weekday INTEGER NOT NULL,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at INTEGER NOT NULL
);
INSERT INTO "staff_users" ("id","email","username","pass_hash","role","name","initials","active","must_change","screens","student_id","failed_attempts","locked_until","created_at") VALUES('sr-admin','sr.admin@staffroom.example.com','sradmin','pbkdf2$100000$00$00','אדמין','SR Admin','SA',1,0,NULL,NULL,0,0,1756684800000);
INSERT INTO "staff_users" ("id","email","username","pass_hash","role","name","initials","active","must_change","screens","student_id","failed_attempts","locked_until","created_at") VALUES('sr-teacher','sr.teacher@staffroom.example.com',NULL,'pbkdf2$100000$00$00','מורה','Shira Levi','SL',1,0,NULL,NULL,0,0,1756684800001);
INSERT INTO "staff_users" ("id","email","username","pass_hash","role","name","initials","active","must_change","screens","student_id","failed_attempts","locked_until","created_at") VALUES('sr-office','sr.office@staffroom.example.com',NULL,'pbkdf2$100000$00$00','מנהלת קבלה','SR Office','SO',1,0,NULL,NULL,0,0,1756684800002);
INSERT INTO "staff_users" ("id","email","username","pass_hash","role","name","initials","active","must_change","screens","student_id","failed_attempts","locked_until","created_at") VALUES('sr-student','sr.student@staffroom.example.com',NULL,'pbkdf2$100000$00$00','תלמיד','Tamar (staff room)','T',1,0,NULL,NULL,0,0,1756684800003);
INSERT INTO "staff_users" ("id","email","username","pass_hash","role","name","initials","active","must_change","screens","student_id","failed_attempts","locked_until","created_at") VALUES('sr-pending','sr.pending@staffroom.example.com',NULL,'pbkdf2$100000$00$00','מורה','Awaiting approval','AA',0,0,NULL,NULL,0,0,1756684800004);
INSERT INTO "staff_users" ("id","email","username","pass_hash","role","name","initials","active","must_change","screens","student_id","failed_attempts","locked_until","created_at") VALUES('sr-teacher-x','teacher.x@example.com',NULL,'pbkdf2$100000$00$00','מורה','Teacher X','TX',1,0,NULL,NULL,0,0,1756684800005);
INSERT INTO "staff_sessions" ("token_hash","user_id","expires_at","created_at") VALUES('0000000000000000000000000000000000000000000000000000000000000000','sr-admin',1756684800000,1756684800000);
INSERT INTO "student_codes" ("code_hash","user_id","issued_by","created_at") VALUES('5f0e1c9a2b3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccdd0','sr-student','sr-teacher',1756771200000);
INSERT INTO "rooms" ("id","name","capacity","kit","active","sort_order","created_at") VALUES('sr-room-a','Staff room test room',10,'Whiteboard',1,5,1756684800000);
INSERT INTO "rooms" ("id","name","capacity","kit","active","sort_order","created_at") VALUES('sr-room-1','Room 1',12,'Projector, whiteboard',1,1,1756684800000);
INSERT INTO "room_bookings" ("id","room_id","title","teacher","weekday","start_min","end_min","note","created_by","created_at") VALUES('sr-b1','sr-room-a','Hebrew for beginners','Shira Levi',1,600,690,'','sr-office',1756684800000);
INSERT INTO "room_bookings" ("id","room_id","title","teacher","weekday","start_min","end_min","note","created_by","created_at") VALUES('sr-b2','sr-room-a','Conversation club','teacher x',3,1080,1170,'Bring snacks','sr-office',1756684800000);
INSERT INTO "room_bookings" ("id","room_id","title","teacher","weekday","start_min","end_min","note","created_by","created_at") VALUES('sr-b3','sr-room-a','Visiting lecturer','Dr. Nobody',5,540,600,'',NULL,1756684800000);
INSERT INTO "room_bookings" ("id","room_id","title","teacher","weekday","start_min","end_min","note","created_by","created_at") VALUES('sr-b4','sr-room-1','Clashes with group X','',2,1110,1200,'',NULL,1756684800000);
