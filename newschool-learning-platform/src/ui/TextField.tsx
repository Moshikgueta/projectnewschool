import type { InputHTMLAttributes } from 'react';

type Props = InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  hint?: string;
  error?: string | undefined;
};

/** Labelled text input; hint and error are announced through aria-describedby. */
export function TextField({ id, label, hint, error, className = '', ...rest }: Props) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-[0.9375rem] font-medium text-fg">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      <input
        id={id}
        {...rest}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        className="min-h-11 rounded-md border border-border-strong bg-surface px-3 text-base text-fg aria-invalid:border-error"
      />
      {error ? (
        <p id={errorId} className="text-sm text-error-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}
