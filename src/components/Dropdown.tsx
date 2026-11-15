import { useEffect, useRef, useState, type ReactNode } from 'react';

type Props = {
  /** Trigger content, usually the label plus a summary. */
  label: ReactNode;
  /** Highlights the trigger when the selection is non-default. */
  active?: boolean;
  align?: 'left' | 'right';
  className?: string;
  panelClassName?: string;
  children: ReactNode;
};

/**
 * Popover used by the desktop toolbar. Closes on outside pointer press and on
 * Escape; mobile keeps the bottom sheet instead.
 */
export function Dropdown({
  label,
  active = false,
  align = 'left',
  className,
  panelClassName,
  children,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div
      className={['dropdown', className].filter(Boolean).join(' ')}
      ref={ref}
    >
      <button
        type="button"
        className={['dropdown__trigger', active ? 'is-active' : '']
          .filter(Boolean)
          .join(' ')}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
        <span className="dropdown__caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div
          className={[
            'dropdown__panel',
            align === 'right' ? 'dropdown__panel--right' : '',
            panelClassName ?? '',
          ]
            .filter(Boolean)
            .join(' ')}
          role="menu"
        >
          {children}
        </div>
      )}
    </div>
  );
}
