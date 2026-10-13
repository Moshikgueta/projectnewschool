import { getTranslations } from 'next-intl/server';

const QUIET =
  'min-h-11 min-w-11 rounded-md px-2 text-sm font-medium text-muted hover:bg-surface-secondary hover:text-fg disabled:opacity-40';

/** Up / down for a cycle or a section; each a small form so it works without JavaScript. */
export async function MoveButtons({
  action,
  id,
  title,
  first,
  last,
}: {
  action: (formData: FormData) => Promise<void>;
  id: string;
  title: string;
  first: boolean;
  last: boolean;
}) {
  const t = await getTranslations('cms');
  return (
    <span className="flex">
      {(['up', 'down'] as const).map((direction) => (
        <form key={direction} action={action}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="direction" value={direction} />
          <button
            type="submit"
            className={QUIET}
            disabled={direction === 'up' ? first : last}
            aria-label={t(direction === 'up' ? 'moveUp' : 'moveDown', { title })}
          >
            {direction === 'up' ? '↑' : '↓'}
          </button>
        </form>
      ))}
    </span>
  );
}
