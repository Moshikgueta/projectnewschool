import type { SelectHTMLAttributes } from 'react';

type Props = SelectHTMLAttributes<HTMLSelectElement> & {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  /** Visually hide the label (it is still announced). For compact table rows. */
  hideLabel?: boolean;
};

/** Labelled native select: works with keyboard, touch and screen readers everywhere. */
export function SelectField({
  id,
  label,
  options,
  hideLabel = false,
  className = '',
  ...rest
}: Props) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label
        htmlFor={id}
        className={hideLabel ? 'sr-only' : 'text-[0.9375rem] font-medium text-fg'}
      >
        {label}
      </label>
      <select
        id={id}
        {...rest}
        className="min-h-11 rounded-md border border-border-strong bg-surface px-3 text-base text-fg"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
