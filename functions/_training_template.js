/* The starting template for New School | Teacher Onboarding.

   Seeded only when a manager presses the button, and always as drafts —
   nothing here reaches a teacher until someone has read it and published it.

   What is deliberately NOT in here: New School's own pedagogy, the cycle
   method, the notebooks' workings, or any policy. Those must come from the
   school's approved documents, so each module carries its objectives and
   topic list (taken from the brief) and a "waiting for official content"
   card where the explanation goes. The classroom scenarios and the
   first-lesson checklist are offered as starting drafts, because the brief
   asks for them by example; they are labelled as drafts for approval. */

const pending = (what) => ({
  type: 'callout', tone: 'pending', title: 'ממתין לתוכן רשמי',
  body: what + '\nהתוכן יוזן מתוך מסמכי New School המאושרים. עד אז החלק הזה מוצג כטיוטה.'
});
const topics = (title, list) => ({ type: 'text', body: title + '\n' + list.map(x => '- ' + x).join('\n') });
const draftNote = { type: 'callout', tone: 'warning', title: 'טיוטה לאישור', body: 'התוכן בחלק הזה הוא הצעה ראשונית לדיון. יש לעבור עליו ולאשר אותו לפני פרסום.' };
const opts = (list) => list.map(([text, quality, feedback]) => ({ text, quality, feedback }));

export const TEMPLATE_MODULES = [
  {
    title: 'Welcome to New School', icon: 'welcome', est: 20,
    description: 'היכרות עם בית הספר, החזון, הצוות ותפקיד המורה.',
    objectives: ['להכיר את בית הספר', 'להבין את החזון', 'להכיר את הצוות', 'להבין את תפקיד המורה'],
    blocks: [
      { type: 'heading', text: 'ברוכים הבאים ל-New School' },
      pending('ברכת הצטרפות, ההיסטוריה של New School, קהל היעד, הערכים והמבנה הארגוני.'),
      { type: 'video', url: '', caption: 'סרטון היכרות — יש להוסיף קישור' },
      pending('אנשי קשר: למי פונים, באילו נושאים ובאיזה ערוץ.'),
      { type: 'open', prompt: 'שאלון היכרות קצר: ספרו על עצמכם, על ניסיון ההוראה שלכם ועל מה שאתם מצפים ללמוד בהכשרה.', review: false, required: true }
    ]
  },
  {
    title: 'Our Teaching Philosophy', icon: 'philosophy', est: 45,
    description: 'הגישה הפדגוגית של New School.',
    objectives: ['להכיר את עקרונות הגישה הפדגוגית של New School', 'לזהות דוגמאות להוראה מוצלחת', 'לנתח תרחישים לאור הגישה'],
    blocks: [
      topics('נושאים במודול:', ['הוראת שפות תקשורתית', 'למידה פעילה', 'תפקיד המורה כמנחה', 'אינטראקציה בין תלמידים', 'למידה באמצעות משימות', 'שימוש במיומנויות שפה', 'דיפרנציאציה', 'משוב פדגוגי', 'רמות CEFR']),
      pending('ההסבר הרשמי לכל אחד מהנושאים, כפי שהוא מוגדר בחומרי New School.'),
      { type: 'accordion', items: [{ title: 'דוגמה להוראה מוצלחת', body: 'להזין דוגמה מאושרת.' }, { title: 'תרחיש לדיון', body: 'להזין תרחיש מאושר.' }] },
      { type: 'reflection', prompt: 'איזה עיקרון בגישה הפדגוגית קרוב לדרך שבה אתם מלמדים היום, ואיזה ידרוש מכם שינוי?', review: false, required: true }
    ]
  },
  {
    title: 'Understanding the New Program', icon: 'program', est: 40,
    description: 'כיצד בנויה תוכנית הלימודים: סילבוסים, יעדים, מחברות ומערכי שיעור.',
    objectives: ['להכיר את מבנה תוכנית הלימודים', 'לדעת היכן נמצאים הסילבוסים ומערכי השיעור', 'לבחור חומר הוראה מתאים למטרה'],
    blocks: [
      topics('נושאים במודול:', ['תוכניות לימודים', 'סילבוסים', 'יעדי למידה', 'מחברות', 'מערכי שיעור', 'תכנון התקדמות', 'בחירת חומרי הוראה']),
      pending('תיאור התוכנית לפי המסמכים המאושרים (Teacher\'s guide to the new program, New Program Syllabus).'),
      { type: 'open', prompt: 'משימה: אתרו מערך שיעור שמתאים למטרה הפדגוגית שתוגדר כאן, צרפו קישור אליו והסבירו את הבחירה.', review: true, required: true }
    ]
  },
  {
    title: 'The Cycle Method', icon: 'cycle', est: 60,
    description: 'שיטת המחזורים של New School — המודול המרכזי בהכשרה.',
    objectives: ['להבין כיצד פועל מחזור למידה', 'לתכנן שיעור לא ליניארי', 'לבחור שתי מיומנויות מרכזיות ופעילויות מתאימות', 'להסביר את השיטה לתלמיד חדש'],
    blocks: [
      topics('נושאים במודול:', ['כיצד פועל מחזור למידה', 'כיצד מתכננים שיעור לא ליניארי', 'כיצד בוחרים שתי מיומנויות מרכזיות', 'כיצד בוחרים פעילויות', 'כיצד מתאימים שיעור להרכב הקבוצה', 'כיצד שומרים על רצף למידה', 'כיצד מסבירים את השיטה לתלמיד חדש']),
      pending('הסבר שיטת המחזורים כפי שהיא מוגדרת במסמכים העדכניים.'),
      { type: 'steps', layout: 'cycle', title: 'תרשים המחזור', note: 'תרשים אינטראקטיבי — יש להזין את שלבי המחזור לפי המסמך הרשמי.', items: [{ title: 'שלב 1', body: 'להזין' }, { title: 'שלב 2', body: 'להזין' }, { title: 'שלב 3', body: 'להזין' }, { title: 'שלב 4', body: 'להזין' }] },
      { type: 'reflection', prompt: 'משימת הסבר לתלמיד: כתבו בכמה משפטים איך הייתם מסבירים לתלמיד חדש את שיטת המחזורים.', review: true, required: true }
    ]
  },
  {
    title: 'Digital Notebooks', icon: 'notebook', est: 30,
    description: 'עבודה עם המחברות הדיגיטליות — לפי שפה ורמה.',
    objectives: ['לפתוח מחברת ולמצוא שיעור', 'לקרוא מערך שיעור', 'לבחור פעילויות ולהשתמש בחומרי תרגול', 'לדווח על שגיאה בחומר'],
    blocks: [
      topics('המורה ילמד:', ['כיצד לפתוח מחברת', 'כיצד למצוא שיעור', 'כיצד לקרוא מערך שיעור', 'כיצד לבחור פעילויות', 'כיצד לעבוד עם תבנית המחברת', 'כיצד להשתמש בחומרי תרגול', 'כיצד לדווח על שגיאה בחומר']),
      { type: 'callout', tone: 'info', title: 'המחברות לפי שפה ורמה', body: 'הקישורים למחברות מנוהלים במרכז המשאבים ומסוננים לפי שפה ורמה.' },
      pending('הדרכה על מבנה המחברת והתבנית (New program notebook Template).'),
      { type: 'open', prompt: 'בחרו פעילות מתוך מחברת והסבירו למה היא מתאימה למטרת השיעור.', review: true, required: true }
    ]
  },
  {
    title: 'How to Teach at New School', icon: 'teach', est: 45,
    description: 'בניית שיעור והפעלתו.',
    objectives: ['להתכונן לשיעור', 'לפתוח שיעור ולהפעיל ידע קודם', 'לנהל עבודה בזוגות ובקבוצות ואת הזמן', 'לתת משוב ולסכם שיעור'],
    blocks: [
      topics('נושאים במודול:', ['הכנה לפני שיעור', 'פתיחת שיעור', 'הפעלת ידע קודם', 'עבודה בזוגות ובקבוצות', 'ניהול זמן', 'בחירת פעילויות', 'טיפול בקשיים', 'מתן משוב', 'סיכום שיעור']),
      { type: 'callout', tone: 'warning', title: 'מבנה לדוגמה', body: 'מבנה השיעור המוצג כאן הוא דוגמה, אלא אם יאושר כמבנה מחייב.' },
      { type: 'steps', layout: 'linear', title: 'סימולציית שיעור', note: 'לחצו על כל שלב כדי לראות מה קורה בו.', items: [{ title: 'הכנה', body: 'להזין' }, { title: 'פתיחה', body: 'להזין' }, { title: 'פעילות מרכזית', body: 'להזין' }, { title: 'משוב', body: 'להזין' }, { title: 'סיכום', body: 'להזין' }] },
      pending('הנחיות New School לבניית שיעור (Teaching at New School).')
    ]
  },
  {
    title: 'Digital Teaching Tools', icon: 'tools', est: 30,
    description: 'הכשרה לשימוש בכלים הטכנולוגיים.',
    objectives: ['להכיר את הכלים שבשימוש New School', 'לדעת לפתור בעיות נפוצות', 'לתרגל שימוש בכל כלי'],
    blocks: [
      { type: 'accordion', items: ['Zoom', 'Quizlet', 'Google Docs', 'Google Drive', 'כלי תרגול'].map(t => ({ title: t, body: 'הסבר · קישור · מדריך · סרטון (אם קיים) · בעיות נפוצות — להזין.' })) },
      { type: 'file', url: '', label: 'Quizlet Guide', note: 'קישור למדריך — מנוהל במרכז המשאבים.' },
      { type: 'checklist', title: 'משימת תרגול', required: true, items: [{ text: 'פתחתי חדר Zoom לבדיקה' }, { text: 'יצרתי סט ב-Quizlet' }, { text: 'שיתפתי מסמך Google Docs' }] }
    ]
  },
  {
    title: 'Classroom Management', icon: 'classroom', est: 40,
    description: 'תרחישים אינטראקטיביים מהכיתה.',
    objectives: ['לזהות שיקולים פדגוגיים במצבים שכיחים', 'להכיר כמה דרכי פעולה סבירות לכל מצב'],
    blocks: [
      draftNote,
      { type: 'text', body: 'ברוב המצבים יש יותר מדרך פעולה סבירה אחת. המשוב מסביר את השיקולים — לא "תשובה נכונה".' },
      {
        type: 'scenario', required: true,
        situation: 'תלמיד בקבוצה אונליין לא משתתף כבר עשר דקות — מצלמה כבויה, לא עונה כשפונים אליו.',
        considerations: 'שיקולים: ייתכן קושי טכני, מבוכה מהרמה או סיבה אישית. פנייה פומבית חוזרת עלולה להגביר מבוכה; התעלמות עלולה להשאיר אותו מחוץ לשיעור.',
        options: opts([
          ['לשלוח הודעה פרטית בצ\'אט ולשאול אם הכול בסדר', 'recommended', 'נותן לתלמיד מקום לענות בלי לחץ של הקבוצה.'],
          ['להעביר את הקבוצה לעבודה בזוגות ולשבץ אותו עם תלמיד תומך', 'acceptable', 'מוריד את הסף להשתתפות, אבל לא בודק אם יש בעיה.'],
          ['לפנות אליו שוב בשמו מול כולם עד שיענה', 'problematic', 'עלול להביך ולהגביר את ההימנעות.']
        ])
      },
      {
        type: 'scenario', required: true,
        situation: 'תלמידה אחת עונה על כל שאלה לפני שאחרים מספיקים לחשוב.',
        considerations: 'שיקולים: לשמור על המוטיבציה שלה ובמקביל לפנות זמן חשיבה לאחרים.',
        options: opts([
          ['לתת זמן חשיבה לכולם לפני שמישהו עונה, ולבחור מי עונה', 'recommended', 'מאזן בין התלמידים בלי להעניש את מי שמוכנה.'],
          ['לתת לה תפקיד — למשל לסכם את התשובות של אחרים', 'acceptable', 'מנתב את האנרגיה, אבל דורש מעקב שלא תהפוך למורה.'],
          ['להתעלם מהתשובות שלה', 'problematic', 'פוגע במוטיבציה ולא מסביר לה מה מצופה.']
        ])
      },
      {
        type: 'scenario', required: true,
        situation: 'באמצע שיעור אונליין השיתוף של המחברת נתקע ותלמידים לא רואים את החומר.',
        considerations: 'שיקולים: לשמור על רצף השיעור. כדאי שתהיה פעילות חלופית שלא תלויה במסך.',
        options: opts([
          ['לעבור לפעילות דיבור שלא דורשת מסך ולטפל בתקלה במקביל', 'recommended', 'השיעור ממשיך והזמן לא הולך לאיבוד.'],
          ['לשלוח קישור ישיר למחברת בצ\'אט', 'acceptable', 'פותר את הבעיה מהר, אם לכל התלמידים יש גישה.'],
          ['לעצור את השיעור עד שהבעיה תיפתר', 'problematic', 'עלול לבזבז חלק גדול מהשיעור.']
        ])
      },
      pending('תרחישים נוספים: רמות שונות בכיתה, תלמיד מתקדם, תלמיד שמתקשה, תלמיד שמאחר, פעילות שלא מצליחה, מספר משתתפים נמוך.')
    ]
  },
  {
    title: 'Policies & Communication', icon: 'policy', est: 25,
    description: 'נהלי העבודה ב-New School.',
    objectives: ['להכיר את נהלי העבודה', 'לדעת למי פונים ובאיזה ערוץ'],
    blocks: [
      { type: 'callout', tone: 'pending', title: 'הנהלים טרם הוזנו', body: 'אין להציג נהלים שלא אושרו. כל הנושאים מטה ממתינים לתוכן רשמי.' },
      { type: 'accordion', items: ['תקשורת עם ההנהלה', 'דיווח על תקלות', 'נוכחות', 'איחורים', 'ביטולים', 'החלפות', 'תקשורת עם תלמידים', 'פרטיות', 'התנהלות מקצועית', 'דיווחים פדגוגיים'].map(t => ({ title: t, body: 'טיוטה — ממתין לנוהל הרשמי.' })) }
    ]
  },
  {
    title: 'Teacher Resource Hub', icon: 'hub', est: 15,
    description: 'מרכז המשאבים המקצועי — מחברות, סילבוסים, מערכי שיעור, מדריכים ועוד.',
    objectives: ['לדעת לחפש ולסנן משאבים לפי שפה, רמה וסוג', 'לסמן משאבים מועדפים'],
    blocks: [
      { type: 'text', body: 'מרכז המשאבים זמין גם אחרי סיום ההכשרה. אפשר לחפש בו ולסנן לפי שפה, רמה, סוג משאב ותגיות, ולסמן מועדפים.' },
      { type: 'checklist', title: 'התנסות', required: true, items: [{ text: 'פתחתי את מרכז המשאבים' }, { text: 'סיננתי לפי השפה שלי' }, { text: 'סימנתי משאב אחד כמועדף' }] }
    ]
  },
  {
    title: 'Before Your First Class', icon: 'checklist', est: 30,
    description: 'הכנה לשיעור הראשון.',
    objectives: ['להגיע לשיעור הראשון מוכנים', 'להגיש תכנון שיעור קצר'],
    blocks: [
      { type: 'checklist', title: 'צ\'קליסט הכנה', required: true, items: ['קראתי את מטרות השיעור', 'פתחתי את המחברת', 'הכנתי פעילויות', 'בדקתי קישורים', 'בדקתי מיקרופון ומצלמה', 'הכנתי פעילות חלופית', 'אני יודע/ת למי לפנות במקרה של בעיה'].map(text => ({ text })) },
      { type: 'lesson_plan', prompt: 'הגישו תכנון קצר לשיעור הראשון שלכם.', review: true, required: true }
    ]
  },
  {
    title: 'Final Assessment', icon: 'assessment', est: 60,
    description: 'הערכה מסכמת: ידע, תרחישים, נהלים, תכנון שיעור ורפלקציה.',
    objectives: ['להראות הבנה של הגישה והשיטה', 'להראות היכרות עם הכלים והנהלים', 'לתכנן שיעור'],
    blocks: [
      { type: 'callout', tone: 'info', title: 'איך ההערכה בנויה', body: 'שאלות הידע נבדקות אוטומטית. תכנון השיעור והרפלקציה נבדקים על ידי המנהל הפדגוגי.\nציון מעבר לא הוגדר — הוא נקבע בהגדרות המודול על ידי ההנהלה.' },
      pending('שאלות ידע, משימות איתור מידע ושאלות על הנהלים — יוזנו אחרי שתוכן המודולים יאושר.'),
      { type: 'lesson_plan', prompt: 'משימת תכנון שיעור מסכמת.', review: true, required: true },
      { type: 'reflection', prompt: 'רפלקציה: מה למדתם בהכשרה, ובמה הייתם רוצים ליווי בחודש הראשון?', review: true, required: true }
    ]
  }
];

/* The eight links from "Training - Rabi & Moshik" (04.03.2026). An example
   of how training material used to be gathered, not a curriculum — so they
   go in as drafts, unchecked, split into general and Italian-specific. */
export const SAMPLE_RESOURCES = [
  { title: 'Info page for Italian teachers', kind: 'guide', language: 'איטלקית', category: 'מידע למורים', url: 'https://docs.google.com/document/d/1BgbRAhThz30HvW8wDXfoR-80ynZc5Aq4/edit?tab=t.0', tags: ['איטלקית'] },
  { title: 'Quaderno Digitale 2025 - Italiano Base', kind: 'notebook', language: 'איטלקית', level: 'Base', category: 'מחברות', url: 'https://docs.google.com/document/d/1nNdo3YGol6Xvg2NiQKMpZSh196Fm0WZgc9sKHtz8iOs/edit?usp=sharing', tags: ['מחברת'] },
  { title: 'Teaching at New School', kind: 'guide', category: 'הדרכה כללית', url: 'https://docs.google.com/document/d/1DGytKA7ViUPE70QHwSagGISVpX8a2wYz/edit', tags: ['הוראה'] },
  { title: 'Quizlet Guide', kind: 'guide', category: 'כלים דיגיטליים', url: 'https://docs.google.com/document/d/1HB5fX2zufSdpYAvD0JDzR1rtQ2E-lAN1/edit', tags: ['Quizlet', 'כלים'] },
  { title: 'New program notebook Template', kind: 'template', category: 'מחברות', program: 'New Program', url: 'https://docs.google.com/document/d/12mJfofmL6abjdhuTJlXw4bqQVmOL79GsmrEppO2i81Q/edit#heading=h.bgbymssbs4o2', tags: ['תבנית'] },
  { title: 'New Program Syllabus with Links to class plans', kind: 'syllabus', category: 'תוכנית לימודים', program: 'New Program', url: 'https://docs.google.com/document/d/1GkyPtygnCNqV6uKH8sbhQdJkWGuBcJOCbZUlqFGzl9w/edit', tags: ['סילבוס', 'מערכי שיעור'] },
  { title: 'Teacher\'s guide to the new program', kind: 'guide', category: 'תוכנית לימודים', program: 'New Program', url: 'https://docs.google.com/document/d/1GO8exvHxtVFfOVlmkfRRDzYseh8MhjRz/edit', tags: ['מדריך'] },
  { title: 'Student\'s Guide to Cycle', kind: 'guide', category: 'שיטת המחזורים', program: 'New Program', url: 'https://docs.google.com/presentation/d/14yEtlQFFLaqMBLehjDrzv6ex2w0zJjxNj484dsFLQu4/edit?usp=sharing', tags: ['מחזורים', 'תלמידים'] }
];
