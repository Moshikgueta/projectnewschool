// The lesson-plan prompt builder (from the staff room's "בונה מערך שיעור";
// docs/STAFF-ROOM-MERGE.md, stage E). It only builds text: the teacher copies
// it into an AI assistant of their choice. Nothing is sent anywhere and
// nothing is stored. The prompt is the school's own, in Hebrew, word for
// word as in the staff room; the form around it follows the interface
// language.

/** Languages the school teaches, by ISO code, with the Hebrew name the prompt uses. */
export const PLAN_LANGUAGES = {
  en: 'אנגלית',
  ar: 'ערבית',
  es: 'ספרדית',
  zh: 'סינית',
  it: 'איטלקית',
  fr: 'צרפתית',
  de: 'גרמנית',
  el: 'יוונית',
  ja: 'יפנית',
  pt: 'פורטוגזית',
  ru: 'רוסית',
  tr: 'טורקית',
  ko: 'קוריאנית',
  hu: 'הונגרית',
  nl: 'הולנדית',
  cs: 'צ׳כית',
  th: 'תאילנדית',
  fa: 'פרסית',
  ro: 'רומנית',
  he: 'עברית',
  pl: 'פולנית',
  ka: 'גאורגית',
  yi: 'יידיש',
  hr: 'קרואטית',
  am: 'אמהרית',
  uk: 'אוקראינית',
} as const;
export type PlanLanguage = keyof typeof PLAN_LANGUAGES;

export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export const CYCLE_LEVELS = [1, 2, 3] as const;
export const PLAN_MODES = ['group', 'private'] as const;
export const PLAN_FOCUS = [
  'grammar',
  'vocabulary',
  'speaking',
  'listening',
  'reading',
  'writing',
  'review',
] as const;

const MODE_HE: Record<(typeof PLAN_MODES)[number], string> = {
  group: 'קבוצה',
  private: 'שיעור פרטי',
};
const FOCUS_HE: Record<(typeof PLAN_FOCUS)[number], string> = {
  grammar: 'דקדוק',
  vocabulary: 'אוצר מילים',
  speaking: 'דיבור ושיחה',
  listening: 'האזנה',
  reading: 'קריאה',
  writing: 'כתיבה',
  review: 'חזרה לפני מבחן',
};

export type LessonPlanInput = {
  language: PlanLanguage;
  cycle: (typeof CYCLE_LEVELS)[number];
  cefr: (typeof CEFR_LEVELS)[number];
  mode: (typeof PLAN_MODES)[number];
  size: string;
  topic: string;
  focus: (typeof PLAN_FOCUS)[number];
  last: string;
  materials: string;
  notes: string;
  check: boolean;
  homework: boolean;
  variations: boolean;
};

export const PLAN_DEFAULTS: LessonPlanInput = {
  language: 'en',
  cycle: 2,
  cefr: 'B1',
  mode: 'group',
  size: '6',
  topic: '',
  focus: 'grammar',
  last: '',
  materials: '',
  notes: '',
  check: true,
  homework: true,
  variations: true,
};

/** Longest each free-text field may be (the prompt stays a prompt). */
export const PLAN_LIMITS = { size: 3, topic: 200, last: 300, materials: 300, notes: 1000 } as const;

/** One line of free text: no line breaks, trimmed, within its limit. */
function oneLine(value: string, max: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** The prompt, exactly as the staff room built it. */
export function buildLessonPrompt(input: LessonPlanInput): string {
  const lang = PLAN_LANGUAGES[input.language];
  const mode = MODE_HE[input.mode];
  const size = oneLine(input.size, PLAN_LIMITS.size);
  const topic = oneLine(input.topic, PLAN_LIMITS.topic);
  const last = oneLine(input.last, PLAN_LIMITS.last);
  const materials = oneLine(input.materials, PLAN_LIMITS.materials);
  const notes = oneLine(input.notes, PLAN_LIMITS.notes);

  const L: string[] = [];
  L.push('אני מורה ל' + lang + ' בבית ספר לשפות בישראל. בנה לי מערך שיעור מלא של 60 דקות.');
  L.push('');
  L.push('נתוני השיעור:');
  L.push('· שפת ההוראה: ' + lang + ', התלמידים דוברי עברית');
  L.push('· רמת הסייקל בבית הספר: רמה ' + input.cycle + ' (מקביל ל-' + input.cefr + ' ב-CEFR)');
  L.push('· מסגרת: ' + mode + (input.mode === 'group' ? ' של ' + (size || '6') + ' תלמידים' : ''));
  L.push('· נושא השיעור: ' + (topic || '[השלם נושא]'));
  L.push('· דגש עיקרי: ' + FOCUS_HE[input.focus]);
  if (last) L.push('· מה כבר כוסה בשיעור הקודם: ' + last);
  if (materials) L.push('· חומרים שיש לי ביד: ' + materials);
  if (notes) L.push('· הערות והתאמות: ' + notes);
  L.push('');
  L.push('בנה את המערך לפי חלוקת הזמן הזו, ואל תחרוג מ-60 דקות:');
  L.push('1. חימום ופתיחה — 5 דקות');
  L.push('2. הצגת החומר החדש — 12 דקות');
  L.push('3. תרגול מובנה — 15 דקות');
  L.push('4. תרגול חופשי, דיבור או סימולציה — 15 דקות');
  L.push('5. סבב סיכום — 8 דקות');
  L.push('6. שיעורי בית והסבר — 5 דקות');
  L.push('');
  L.push('לכל שלב כתוב:');
  L.push('· מה המורה עושה ואומר, ומה התלמידים עושים');
  L.push('· משפטים ושאלות לדוגמה ב' + lang + ' עם תרגום לעברית');
  L.push('· איך אני מזהה שהשלב הצליח, ומה לעשות אם הוא לא');
  L.push('');
  const tail: string[] = [];
  if (input.check) tail.push('3 שאלות קצרות לבדיקת הבנה בסוף השיעור, עם התשובות');
  if (input.homework) tail.push('הצעה לשיעורי בית של 15–20 דקות שנובעת מהשיעור');
  if (input.variations) tail.push('ווריאציה לתלמיד שמתקשה וווריאציה לתלמיד שמקדים את הקבוצה');
  if (tail.length) {
    L.push('הוסף בסוף:');
    for (const t of tail) L.push('· ' + t);
    L.push('');
  }
  L.push(
    'כתוב בעברית, בטבלה או ברשימה נקייה שאפשר להעתיק למחברת הדיגיטלית. בלי הקדמות ובלי הסברים על עצמך — רק המערך.',
  );
  return L.join('\n');
}

/** A group's details as the form's starting point ("load from a group"). */
export function planFromGroup(group: {
  languageCode: string;
  cefr: string | null;
  cyclePosition: number | null;
  students: number;
  name: string;
}): Partial<LessonPlanInput> {
  const out: Partial<LessonPlanInput> = {
    mode: 'group',
    size: String(group.students || 6),
    materials: 'המחברת הדיגיטלית של ' + group.name,
  };
  const lang = group.languageCode.split('-')[0] ?? '';
  if (lang in PLAN_LANGUAGES) out.language = lang as PlanLanguage;
  if ((CEFR_LEVELS as readonly string[]).includes(group.cefr ?? '')) {
    out.cefr = group.cefr as LessonPlanInput['cefr'];
  }
  if (group.cyclePosition === 1 || group.cyclePosition === 2 || group.cyclePosition === 3) {
    out.cycle = group.cyclePosition;
  }
  return out;
}
