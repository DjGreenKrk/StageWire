// Komponenty interfejsu StageWire (React). Prymitywy pochodzą ze wspólnego pakietu GreenCrew (`./greencrew`, źródło: GreenCrew_Tools_Docs),
// w wariancie gęstym (desktop); tutaj są tylko cienkie adaptery dla API używanego w oknach StageWire oraz elementy specyficzne dla edytora.
// Zmiana wspólnego komponentu zmienia wygląd tych elementów po synchronizacji kopii (`npm run sync:greencrew`).
import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode, Ref, SelectHTMLAttributes } from 'react';
import { GreenCrewButton, GreenCrewCheckbox, GreenCrewDialog, GreenCrewField, GreenCrewInput, GreenCrewNotice, GreenCrewSelect } from './greencrew/index.js';

const cx = (...a: (string | false | undefined)[]) => a.filter(Boolean).join(' ');

/** Okno modalne (wspólne `GreenCrewDialog`). */
export interface DialogProps { id?: string; title: string; onClose(): void; footer?: ReactNode; children: ReactNode; width?: number }
export function Dialog({ width = 1040, ...rest }: DialogProps) { return <GreenCrewDialog width={width} {...rest} />; }

/** Przycisk (wspólny `GreenCrewButton`, wariant gęsty): `default` = secondary, `primary`, `ghost` = tekstowy, `danger` = destrukcyjny. */
export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> { variant?: 'default' | 'primary' | 'ghost' | 'danger'; size?: 'md' | 'sm'; icon?: boolean; type?: 'button' | 'submit' }
const VARIANT = { default: 'secondary', primary: 'primary', ghost: 'text', danger: 'destructive' } as const;
export function Button({ variant = 'default', size = 'md', icon, children, onClick, style, ...rest }: ButtonProps) {
  return <GreenCrewButton {...rest} variant={VARIANT[variant]} size={size === 'sm' ? 'sm' : 'md'} density="compact" iconOnly={icon} onClick={onClick} style={style}>{children}</GreenCrewButton>;
}

/** Pole z etykietą (wspólne `GreenCrewField`). */
export interface FieldProps { label: string; required?: boolean; hint?: string; error?: string; children: ReactNode; grow?: number; minWidth?: number }
export const Field = GreenCrewField;

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> { ref?: Ref<HTMLInputElement> }
export function Input({ onChange, ...rest }: InputProps) { return <GreenCrewInput {...rest} density="compact" onChange={(_v, e) => onChange?.(e)} />; }
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> { options: [string, string][] }
export function Select({ onChange, ...rest }: SelectProps) { return <GreenCrewSelect {...rest} density="compact" onChange={(_v, e) => onChange?.(e)} />; }
export interface CheckboxProps { label: string; checked?: boolean; id?: string; disabled?: boolean; onChange?(e: { target: { checked: boolean } }): void }
export function Checkbox({ onChange, ...rest }: CheckboxProps) { return <GreenCrewCheckbox {...rest} density="compact" onChange={(c) => onChange?.({ target: { checked: c } })} />; }

/** Komunikat (wspólne `GreenCrewNotice`): `info`, `error`, `ok`, `warn`. */
export interface NoticeProps { kind?: 'info' | 'error' | 'ok' | 'warn'; children: ReactNode; id?: string }
export function Notice({ kind = 'info', ...rest }: NoticeProps) { return <GreenCrewNotice tone={kind === 'warn' ? 'warning' : kind} {...rest} />; }

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
export function Chip({ label, color, title }: ChipProps) { return <span className="sw-chip" title={title} style={color ? ({ '--c': color } as CSSProperties) : undefined}><i />{label}</span>; }
export interface PanelProps { title?: string; children: ReactNode; className?: string }
export function Panel({ title, children, className }: PanelProps) { return <div className={cx('sw-panel', className)}>{title && <h4>{title}</h4>}{children}</div>; }
export function Row({ children }: { children: ReactNode }) { return <div className="sw-row">{children}</div>; }
export function Section({ children }: { children: ReactNode }) { return <div className="sw-section">{children}</div>; }
/** Powierzchnia aplikacji: ciemne tło, Roboto i kolor tekstu. Opakuj nią okna i ekrany, żeby tokeny działały. */
export interface ThemeProps { children: ReactNode; className?: string; padded?: boolean }
export function Theme({ children, className, padded = true }: ThemeProps) { return <div className={cx('sw-theme', padded && 'sw-theme-pad', className)}>{children}</div>; }
