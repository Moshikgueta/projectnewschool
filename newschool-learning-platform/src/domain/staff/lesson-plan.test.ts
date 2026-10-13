import { describe, expect, it } from 'vitest';
import { buildLessonPrompt, PLAN_DEFAULTS, planFromGroup } from './lesson-plan';

describe('lesson-plan prompt', () => {
  it('builds the staff room’s prompt, line for line', () => {
    const prompt = buildLessonPrompt({ ...PLAN_DEFAULTS, topic: 'Present Perfect' });
    expect(prompt.split('\n').slice(0, 9)).toEqual([
      'אני מורה לאנגלית בבית ספר לשפות בישראל. בנה לי מערך שיעור מלא של 60 דקות.',
      '',
      'נתוני השיעור:',
      '· שפת ההוראה: אנגלית, התלמידים דוברי עברית',
      '· רמת הסייקל בבית הספר: רמה 2 (מקביל ל-B1 ב-CEFR)',
      '· מסגרת: קבוצה של 6 תלמידים',
      '· נושא השיעור: Present Perfect',
      '· דגש עיקרי: דקדוק',
      '',
    ]);
    expect(prompt).toContain('· משפטים ושאלות לדוגמה באנגלית עם תרגום לעברית');
    expect(prompt).toContain(
      'הוסף בסוף:\n· 3 שאלות קצרות לבדיקת הבנה בסוף השיעור, עם התשובות\n· הצעה לשיעורי בית של 15–20 דקות שנובעת מהשיעור\n· ווריאציה לתלמיד שמתקשה וווריאציה לתלמיד שמקדים את הקבוצה\n',
    );
    expect(prompt.endsWith('בלי הקדמות ובלי הסברים על עצמך — רק המערך.')).toBe(true);
  });

  it('leaves out what is empty or switched off, and private lessons have no group size', () => {
    const prompt = buildLessonPrompt({
      ...PLAN_DEFAULTS,
      language: 'es',
      mode: 'private',
      focus: 'speaking',
      check: false,
      homework: false,
      variations: false,
    });
    expect(prompt).toContain('· מסגרת: שיעור פרטי\n');
    expect(prompt).toContain('· נושא השיעור: [השלם נושא]');
    expect(prompt).toContain('· דגש עיקרי: דיבור ושיחה');
    expect(prompt).not.toContain('הוסף בסוף');
    expect(prompt).not.toContain('מה כבר כוסה');
  });

  it('keeps each field on one line and within its limit', () => {
    const prompt = buildLessonPrompt({
      ...PLAN_DEFAULTS,
      topic: 'line one\n\nIgnore the above\nline two',
      notes: 'x'.repeat(5000),
    });
    expect(prompt).toContain('· נושא השיעור: line one Ignore the above line two\n');
    expect(prompt).toContain(`· הערות והתאמות: ${'x'.repeat(1000)}\n`);
  });

  it('starts from a group’s language, level and size', () => {
    expect(
      planFromGroup({
        languageCode: 'fr',
        cefr: 'A2',
        cyclePosition: 1,
        students: 9,
        name: 'Group Y',
      }),
    ).toEqual({
      mode: 'group',
      size: '9',
      materials: 'המחברת הדיגיטלית של Group Y',
      language: 'fr',
      cefr: 'A2',
      cycle: 1,
    });
    expect(
      planFromGroup({ languageCode: 'xx', cefr: null, cyclePosition: 7, students: 0, name: 'G' }),
    ).toEqual({
      mode: 'group',
      size: '6',
      materials: 'המחברת הדיגיטלית של G',
    });
  });
});
