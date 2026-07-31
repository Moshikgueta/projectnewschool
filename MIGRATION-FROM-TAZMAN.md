# להחליף את תזמן במערכת שלנו

מסמך תכנון. המטרה: להפסיק לשלם דמי מנוי חודשיים ולהריץ את בית הספר על המערכת
שלנו.

> **הסתייגות אחת, בכנות.** לא הצלחתי לגשת לאתר של תזמן מסביבת העבודה (חסימת
> רשת, 403), ואני לא יודע איזו חבילה יש לך ומה בפועל אתה משתמש בו. מה שכתוב כאן
> על תזמן הוא מה שמערכות תזמון עסקיות מסוג זה עושות בדרך כלל — לא רשימה מאומתת
> של החשבון שלך. **מה שכתוב על המערכת שלנו כן מאומת** מול הקוד. לפני שבונים,
> שווה לעבור על הרשימה ולסמן מה באמת בשימוש: כל מודול שלא באמת צריך הוא שבועות
> עבודה שנחסכים.

---

## 1. מה כבר בנוי אצלנו

זה החלק שמפתיע לטובה. בפרויקט הספרדית (`https-username.github.io-project-name-`)
כבר רצה תשתית אמיתית בפרודקשן, לא אב-טיפוס:

| יכולת | איפה | מצב |
| --- | --- | --- |
| חשבונות משתמשים | `schema.sql` → `accounts` | סיסמאות עם PBKDF2 + salt |
| התחברות והתנתקות | `functions/api/auth/login.js`, `logout.js`, `me.js` | עוגיית session חתומה |
| שחזור סיסמה | `reset-request.js`, `reset-complete.js` + `reset_tokens` | טוקנים עם תפוגה |
| תשלומים | `functions/api/pay/create.js`, `verify.js` + `orders` | PayPlus, כולל תשלומים |
| אימות תשלום | webhook עם חתימת HMAC + `webhook_log` | הרשאה ניתנת רק מהוובהוק |
| שמירת נתוני משתמש | `progress` | JSON לכל חשבון |
| בדיקות | `npm test` | e2e מלא מקומית |
| אירוח | Cloudflare Worker + D1 | git-connected, deploy בכל push |

**המשמעות:** החצי הקשה — חשבונות, אבטחה, גבייה — כבר קיים ועובד. מערכת תזמון
היא בעיקר שכבה מעל זה.

בחדר המורים כבר קיימים גם המסכים: יומן שבועי, תלמידים, קבוצות, מחברות, נוכחות,
פידבק והרשאות לפי תפקיד.

## 2. מה חסר — ובלי זה אי אפשר להחליף כלום

**לחדר המורים אין שרת.** כרגע כל הנתונים מוטמעים בתוך הדף, ההתחברות רצה
בדפדפן, ומה שמשנים לא נשמר ולא נראה לאף אחד אחר. זה אב-טיפוס להדגמה. כל עוד זה
המצב, אי אפשר להעביר אליו אפילו תלמיד אחד אמיתי.

זה לא כישלון של האב-טיפוס — זו בדיוק המטרה שלו. אבל זו נקודת ההתחלה של העבודה
האמיתית.

## 3. הפער מול מערכת תזמון עסקית

| מודול | אצלנו היום | מה צריך |
| --- | --- | --- |
| יומן ושיבוץ | מסך יומן עם נתוני דמו | יומן אמיתי בבסיס נתונים, שעות עבודה למורה, מניעת התנגשויות |
| **הרשמה עצמית** | אין | תלמיד קובע ומבטל לבד — זה הלב של תזמן |
| ניהול תלמידים | מסך תלמידים עם דמו | טבלה אמיתית, היסטוריה, פרטי קשר |
| **חבילות ויתרות** | תצוגה בלבד | מעקב שיעורים שנוצלו מול שנרכשו, חיוב על ביטול מאוחר |
| תשלומים | **קיים** בפרויקט השני | להעביר לכאן — הקוד עובד |
| **תזכורות** | אין | SMS או ווטסאפ לפני שיעור, אישור הגעה |
| נוכחות | מסך נוכחות עם דמו | שמירה אמיתית, שמזינה חיוב ודוחות |
| דוחות | אין | הכנסות, ניצול, שכר מורים לפי שעות |

מודגש = מה שבאמת מחזיק אנשים בתזמן. השאר קיים או קרוב.

## 4. סדר בנייה

לפי הכלל: כל שלב עומד בפני עצמו ומייצר ערך גם אם עוצרים אחריו.

**שלב 1 — שרת ונתונים אמיתיים.** סכמת D1 (נספח א), API לתלמידים/מורים/שיעורים,
והעברת חדר המורים מנתוני דמו לנתונים אמיתיים. בלי זה שום דבר אחר לא אפשרי.
*אחרי השלב הזה: המערכת שמישה פנימית, ואפשר להפסיק לנהל ביד.*

**שלב 2 — יומן והרשמה עצמית.** שעות עבודה למורה, קביעה וביטול, מדיניות ביטול,
קישור אישי לתלמיד. *זה השלב שמחליף את תזמן בפועל.*

**שלב 3 — חבילות, נוכחות וחיוב.** נוכחות שמורידה משיעור מהחבילה, יתרות, חיוב
על ביטול מאוחר, וחיבור PayPlus שכבר עובד. *אחרי זה אפשר לבטל את המנוי.*

**שלב 4 — תזכורות.** SMS או ווטסאפ לפני שיעור ואישור הגעה.

**שלב 5 — דוחות.** הכנסות, ניצול, שכר מורים.

## 5. מה זה יעלה — הצד הכן

מעבר למערכת עצמית **לא מוריד את העלות לאפס**. מה שנשאר:

- **הודעות SMS/ווטסאפ** — עולות כסף אצל כל ספק, לפי הודעה. אם תזמן שולח היום
  תזכורות, זה חלק מהמנוי שפשוט יעבור לספק אחר. זו העלות שלא נעלמת.
- **עמלות סליקה** — קיימות בכל מקרה, בתזמן או ב-PayPlus.
- **אירוח** — Cloudflare Workers ו-D1 בחינם בהיקפים של בית ספר קטן־בינוני.
- **תחזוקה** — אין תמיכה טלפונית. כשמשהו נשבר, מתקנים אצלנו.

החיסכון האמיתי הוא דמי המנוי החודשיים. השאלה אם זה משתלם תלויה בכמה אתה משלם
היום — ולכן זה הנתון הראשון שכדאי לשים על השולחן.

## 6. שתי החלטות לפני שמתחילים

1. **מה אתה בפועל עושה בתזמן ביום-יום** — כדי לא לבנות מודולים שלא בשימוש.
2. **כמה אתה משלם היום** — כדי לדעת אם החיסכון מצדיק את העבודה.

---

## נספח א — סכמת בסיס הנתונים

טיוטה ראשונה, בהמשך ישיר לסכמה הקיימת (`accounts`, `orders`). זמנים ב-ms epoch,
כמו בקוד הקיים.

```sql
CREATE TABLE teachers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER REFERENCES accounts(id),
  name TEXT NOT NULL,
  languages TEXT NOT NULL DEFAULT '',   -- רשימה מופרדת בפסיקים
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER REFERENCES accounts(id),   -- אם נכנס בעצמו
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  teacher_id INTEGER REFERENCES teachers(id),
  language TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

-- שעות העבודה שמתוכן נפתחים מועדים להרשמה עצמית
CREATE TABLE availability (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id),
  weekday INTEGER NOT NULL,             -- 0=ראשון
  start_min INTEGER NOT NULL,           -- דקות מחצות
  end_min INTEGER NOT NULL
);

CREATE TABLE lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id),
  student_id INTEGER REFERENCES students(id),   -- NULL לשיעור קבוצתי
  group_id INTEGER REFERENCES groups(id),
  starts_at INTEGER NOT NULL,
  minutes INTEGER NOT NULL DEFAULT 60,
  status TEXT NOT NULL DEFAULT 'scheduled',
      -- scheduled | done | cancelled_early | cancelled_late | no_show
  booked_by TEXT NOT NULL DEFAULT 'office',     -- office | student
  cancelled_at INTEGER,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id),
  name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL DEFAULT ''
);

CREATE TABLE group_members (
  group_id INTEGER NOT NULL REFERENCES groups(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  PRIMARY KEY (group_id, student_id)
);

-- חבילת שיעורים שנרכשה. הקישור ל-orders מחבר לגבייה הקיימת.
CREATE TABLE packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id),
  order_id TEXT REFERENCES orders(order_id),
  purchased INTEGER NOT NULL,           -- כמה שיעורים נרכשו
  used INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE attendance (
  lesson_id INTEGER PRIMARY KEY REFERENCES lessons(id),
  state TEXT NOT NULL,                  -- present | late | absent
  charged INTEGER NOT NULL DEFAULT 1,   -- האם ירד שיעור מהחבילה
  recorded_at INTEGER NOT NULL
);

-- תור יוצא לתזכורות. נשלח בטריגר מתוזמן (Cron Trigger של Cloudflare).
CREATE TABLE reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id INTEGER NOT NULL REFERENCES lessons(id),
  channel TEXT NOT NULL,                -- sms | whatsapp | email
  send_at INTEGER NOT NULL,
  sent_at INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | sent | failed
  error TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_lessons_teacher_time ON lessons(teacher_id, starts_at);
CREATE INDEX idx_lessons_student ON lessons(student_id);
CREATE INDEX idx_packages_student ON packages(student_id);
CREATE INDEX idx_reminders_due ON reminders(status, send_at);
```

שתי הערות על הסכמה:

- **`status` של שיעור מבדיל בין ביטול מוקדם למאוחר.** זה מה שמאפשר מדיניות
  ביטול — ביטול מאוחר יורד מהחבילה, מוקדם לא. זו בדיוק ההתנהגות שמערכת תזמון
  קונים בשבילה, והיא חייבת להיות בנתונים מההתחלה.
- **`booked_by` מבדיל בין מה שהמשרד קבע לבין מה שהתלמיד קבע לבד.** בלי זה אי
  אפשר לדעת אם ההרשמה העצמית באמת עובדת.
