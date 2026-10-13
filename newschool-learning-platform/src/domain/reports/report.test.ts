import { describe, expect, it } from 'vitest';
import { parseReportForm, REPORT_MESSAGE_MAX, REPORT_SUGGESTION_MAX } from './report';

const ACTIVITY = '70000000-0000-4000-8000-000000000006';
const ITEM = '80000000-0000-4000-8000-000000000061';
const SECTION = '60000000-0000-4000-8000-000000000001';

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

describe('a mistake report', () => {
  it('is about a question of an exercise, with an optional suggested answer', () => {
    const parsed = parseReportForm(
      form({ activityId: ACTIVITY, itemId: ITEM, message: '  Two answers are right.  ' }),
    );
    expect(parsed.success && parsed.data).toEqual({
      activityId: ACTIVITY,
      itemId: ITEM,
      sectionId: undefined,
      message: 'Two answers are right.',
      suggestedAnswer: '',
    });
  });

  it('or about a notebook page', () => {
    const parsed = parseReportForm(
      form({
        sectionId: SECTION,
        activityId: '',
        itemId: '',
        message: 'Typo',
        suggestedAnswer: 'Hola',
      }),
    );
    expect(parsed.success && parsed.data.sectionId).toBe(SECTION);
  });

  it('needs a message within the limit, and a suggestion within its own', () => {
    expect(parseReportForm(form({ sectionId: SECTION, message: '   ' })).success).toBe(false);
    expect(
      parseReportForm(form({ sectionId: SECTION, message: 'x'.repeat(REPORT_MESSAGE_MAX) }))
        .success,
    ).toBe(true);
    expect(
      parseReportForm(form({ sectionId: SECTION, message: 'x'.repeat(REPORT_MESSAGE_MAX + 1) }))
        .success,
    ).toBe(false);
    expect(
      parseReportForm(
        form({
          sectionId: SECTION,
          message: 'Wrong',
          suggestedAnswer: 'x'.repeat(REPORT_SUGGESTION_MAX + 1),
        }),
      ).success,
    ).toBe(false);
  });

  it('is about exactly one thing, and a question only with its exercise', () => {
    expect(parseReportForm(form({ message: 'Wrong' })).success).toBe(false);
    expect(
      parseReportForm(form({ activityId: ACTIVITY, sectionId: SECTION, message: 'Wrong' })).success,
    ).toBe(false);
    expect(
      parseReportForm(form({ itemId: ITEM, sectionId: SECTION, message: 'Wrong' })).success,
    ).toBe(false);
    expect(parseReportForm(form({ activityId: 'not-an-id', message: 'Wrong' })).success).toBe(
      false,
    );
  });
});
