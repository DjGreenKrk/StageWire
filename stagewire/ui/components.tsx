// Biblioteka komponentów StageWire UI (React). Tokeny i style: `ui/styles.css`. Każdy komponent ma jawnie typowane `Props`.
import { useEffect, useId, useRef, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';

const cx = (...a: (string | false | undefined)[]) => a.filter(Boolean).join(' ');

/** Okno modalne: nagłówek z przyciskiem zamknięcia, przewijana treść i stopka z akcjami. Esc i klik w tło zamykają; fokus trafia do okna. */
export interface DialogProps { id?: string; title: string; onClose(): void; footer?: ReactNode; children: ReactNode; width?: number }
export function Dialog({ id, title, onClose, footer, children, width }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null), titleId = useId();
  useEffect(() => { (ref.current?.querySelector('input,select,button:not([data-sw-close])') as HTMLElement | null)?.focus(); }, []);
  return (
    <div className="sw-overlay" id={id} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }}>
      <div className="sw-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} style={width ? { width } : undefined}>
        <div className="sw-dialog-head"><h2 id={titleId}>{title}</h2><Button variant="ghost" size="sm" icon aria-label="Zamknij" data-sw-close onClick={onClose}>✕</Button></div>
        <div className="sw-dialog-body">{children}</div>
        {footer && <div className="sw-dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'default' | 'primary' | 'ghost' | 'danger'; size?: 'md' | 'sm'; icon?: boolean }
export function Button({ variant = 'default', size = 'md', icon, className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={cx('sw-btn', variant !== 'default' && `sw-btn-${variant}`, size === 'sm' && 'sw-btn-sm', icon && 'sw-btn-icon', className)} {...rest} />;
}

/** Pole z etykietą, podpowiedzią i komunikatem błędu. `children` to kontrolka (Input, Select). */
export interface FieldProps { label: string; required?: boolean; hint?: string; error?: string; children: ReactNode; className?: string; grow?: number; minWidth?: number }
export function Field({ label, required, hint, error, children, className, grow, minWidth }: FieldProps) {
  return (
    <label className={cx('sw-field', error && 'sw-field-error', className)} style={{ flexGrow: grow, flexBasis: minWidth }}>
      <span className="sw-label">{label}{required && <span className="sw-req">*</span>}</span>
      {children}
      {error ? <span className="sw-error-text">{error}</span> : hint ? <span className="sw-hint">{hint}</span> : null}
    </label>
  );
}
export type InputProps = InputHTMLAttributes<HTMLInputElement>;
export function Input({ className, ...rest }: InputProps) { return <input className={cx('sw-input', className)} {...rest} />; }
export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> { options: [string, string][] }
export function Select({ options, className, ...rest }: SelectProps) { return <select className={cx('sw-select', className)} {...rest}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>; }
export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> { label: string }
export function Checkbox({ label, className, ...rest }: CheckboxProps) { return <label className={cx('sw-check', className)}><input type="checkbox" {...rest} />{label}</label>; }

/** Wybór jednej z kilku opcji jako karty (zamiast listy rozwijanej, gdy opcji jest mało i warto je opisać). */
export interface ChoiceOption { value: string; title: string; icon?: string; hint?: string }
export interface ChoiceCardsProps { options: ChoiceOption[]; value: string; onChange(v: string): void; idPrefix?: string; label: string }
export function ChoiceCards({ options, value, onChange, idPrefix, label }: ChoiceCardsProps) {
  return (
    <div className="sw-choices" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} id={idPrefix ? `${idPrefix}-${o.value}` : undefined} type="button" role="radio" aria-checked={o.value === value} className="sw-card" title={o.hint} onClick={() => onChange(o.value)}>
          {o.icon && <span className="sw-card-ico" aria-hidden>{o.icon}</span>}<span className="sw-card-title">{o.title}</span>
        </button>
      ))}
    </div>
  );
}

export interface ChipProps { label: string; color?: string; title?: string }
export function Chip({ label, color, title }: ChipProps) { return <span className="sw-chip" title={title} style={color ? ({ '--c': color } as React.CSSProperties) : undefined}><i />{label}</span>; }
export interface PanelProps { title?: string; children: ReactNode; className?: string }
export function Panel({ title, children, className }: PanelProps) { return <div className={cx('sw-panel', className)}>{title && <h4>{title}</h4>}{children}</div>; }
export interface NoticeProps { kind?: 'info' | 'error' | 'ok' | 'warn'; children: ReactNode; id?: string }
export function Notice({ kind = 'info', children, id }: NoticeProps) { return <div id={id} className={cx('sw-notice', kind !== 'info' && `sw-notice-${kind}`)} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>; }
export function Row({ children }: { children: ReactNode }) { return <div className="sw-row">{children}</div>; }
export function Section({ children }: { children: ReactNode }) { return <div className="sw-section">{children}</div>; }
