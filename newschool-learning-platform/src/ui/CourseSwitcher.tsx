'use client';

/**
 * Switches between the student's courses. A plain GET form, so it works
 * without JavaScript; with JavaScript it submits as soon as the choice changes.
 */
export function CourseSwitcher({
  label,
  courses,
  current,
  submitLabel,
  action = '/learn',
}: {
  label: string;
  courses: { id: string; title: string }[];
  current: string;
  submitLabel: string;
  /** The page that shows the chosen course. */
  action?: string;
}) {
  return (
    <form method="get" action={action} className="flex items-center gap-2">
      <label htmlFor="course" className="text-sm text-muted">
        {label}
      </label>
      <select
        id="course"
        name="course"
        defaultValue={current}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="min-h-11 rounded-md border border-border-strong bg-surface px-3 text-[0.9375rem]"
      >
        {courses.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className="min-h-11 px-2 font-medium text-primary">
          {submitLabel}
        </button>
      </noscript>
    </form>
  );
}
