import React, { useEffect, useRef } from 'react';
import Icon from '@mdi/react';
import {
  mdiClose,
  mdiPizza,
  mdiBottleSodaClassic,
  mdiCandy,
  mdiHamburger,
  mdiFood,
  mdiCoffee,
  mdiIceCream,
  mdiBreadSlice,
  mdiFoodDrumstick,
  mdiFrenchFries,
  mdiCup,
  mdiBowlMixOutline
} from '@mdi/js';

export const icons: Record<string, string> = {
  pizza: mdiPizza,
  drink: mdiBottleSodaClassic,
  candy: mdiCandy,
  burger: mdiHamburger,
  food: mdiFood,
  coffee: mdiCoffee,
  dessert: mdiIceCream,
  bread: mdiBreadSlice,
  chicken: mdiFoodDrumstick,
  'food-drumstick': mdiFoodDrumstick,
  'french-fries': mdiFrenchFries,
  hamburger: mdiHamburger,
  cup: mdiCup,
  'bottle-water': mdiBottleSodaClassic,
  'bowl-mix': mdiBowlMixOutline,
  'bottle-soda-classic': mdiBottleSodaClassic
};
export const I = ({ path, size = 1 }: { path: string; size?: number }) => (
  <Icon path={path} size={size} aria-hidden="true" />
);
export function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark ${small ? 'small' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 256 256">
        <rect width="256" height="256" rx="60" fill="#163f35" />
        <path d="M68 63h120v135l-15-10-15 10-15-10-15 10-15-10-15 10-15-10-15 10z" fill="#f5f5e9" />
        <path d="M95 94h66M95 118h45" stroke="#163f35" strokeWidth="12" strokeLinecap="round" />
        <circle cx="153" cy="159" r="30" fill="#edab55" />
        <path
          d="m140 159 9 9 17-19"
          stroke="#163f35"
          strokeWidth="8"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const id = React.useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const dialog = ref.current!;
    const getFocus = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'
        )
      ).filter((element) => element.getClientRects().length > 0);
    const timer = window.setTimeout(
      () => (dialog.querySelector<HTMLElement>('[autofocus]') ?? getFocus()[0] ?? dialog).focus(),
      20
    );
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close.current();
      }
      if (event.key === 'Tab') {
        const elements = getFocus(),
          first = elements[0],
          last = elements[elements.length - 1];
        if (!first) {
          event.preventDefault();
          return;
        }
        if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === dialog)
        ) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop">
      <div
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        ref={ref}
        tabIndex={-1}
      >
        <header className="modal-heading">
          <div>
            <h2 id={id}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            type="button"
            className="icon-button"
            title="Close dialog"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <I path={mdiClose} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
export function Field({
  label,
  children,
  hint
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Toggle({
  checked,
  onChange,
  label,
  detail,
  disabled
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  detail?: string;
  disabled?: boolean;
}) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        {detail && <small>{detail}</small>}
      </span>
      <input
        type="checkbox"
        className="toggle"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
      />
    </label>
  );
}
export function Empty({
  path = mdiFood,
  title,
  text
}: {
  path?: string;
  title: string;
  text: string;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <I path={path} size={1.6} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
export function ErrorText({ error }: { error: string }) {
  return error ? (
    <div className="form-error" role="alert">
      {error}
    </div>
  ) : null;
}
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
