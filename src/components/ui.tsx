// Small shared building blocks, all flat. Two kinds of pressable thing: quiet
// "ghost" buttons (no fill until hovered) for chrome and transport, and filled
// buttons (`btn`, `btn-ink`) for actions. Both shrink a little when pressed,
// including when their keyboard shortcut fires (`flash`).
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useFlash, type FlashId } from "../hooks/useFlash";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { flash?: FlashId };

const ghost =
  "transition-[background-color,color,opacity,scale] duration-150 ease-snappy active:scale-[0.94] data-[flash]:scale-[0.94] disabled:pointer-events-none disabled:opacity-35";

/** Quiet square button for chrome: top bar, list headers, row actions. */
export function IconButton({ active, flash, className = "", ...rest }: ButtonProps & { active?: boolean }) {
  const flashing = useFlash(flash);
  return (
    <button
      {...rest}
      data-flash={flashing || undefined}
      className={`${ghost} grid h-7 min-w-7 place-items-center rounded-[7px] px-1.5 ${
        active ? "bg-press text-fg" : "text-muted hover:bg-hover hover:text-fg data-[flash]:bg-press"
      } ${className}`}
    />
  );
}

/** A transport button on the deck. `ink` is play: the one solid button there. */
export function DeckButton({ ink, flash, className = "", ...rest }: ButtonProps & { ink?: boolean }) {
  const flashing = useFlash(flash);
  return (
    <button
      {...rest}
      data-flash={flashing || undefined}
      className={`grid place-items-center disabled:pointer-events-none ${
        ink ? "btn-ink" : `${ghost} text-fg/75 hover:bg-hover hover:text-fg active:bg-press data-[flash]:bg-press data-[flash]:text-fg`
      } ${className}`}
    />
  );
}

/** A keyboard key, drawn as a small outlined key. */
export function Kbd({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={`inline-grid h-[19px] min-w-[19px] place-items-center rounded-[5px] px-1 font-sans text-[11px] leading-none font-medium text-muted shadow-[inset_0_0_0_1px_var(--line-strong)] ${className}`}
    >
      {children}
    </kbd>
  );
}

/** − value + on a tinted strip; used by the speed and step controls. */
export function Stepper({ children, onDec, onInc, decTitle, incTitle, decFlash, incFlash }: {
  children: ReactNode;
  onDec: () => void;
  onInc: () => void;
  decTitle: string;
  incTitle: string;
  decFlash?: FlashId;
  incFlash?: FlashId;
}) {
  return (
    <div className="tint flex h-8 items-center rounded-[9px] p-0.5">
      <StepButton title={decTitle} onClick={onDec} flash={decFlash}>
        −
      </StepButton>
      <div className="flex min-w-0 flex-1 items-center justify-center">{children}</div>
      <StepButton title={incTitle} onClick={onInc} flash={incFlash}>
        +
      </StepButton>
    </div>
  );
}

function StepButton({ flash, ...rest }: ButtonProps) {
  const flashing = useFlash(flash);
  return (
    <button
      {...rest}
      data-flash={flashing || undefined}
      className={`${ghost} grid h-7 w-7 shrink-0 place-items-center rounded-[7px] text-[15px] leading-none text-muted hover:bg-hover hover:text-fg active:bg-press data-[flash]:bg-press data-[flash]:text-fg`}
    />
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200 ${on ? "bg-ink" : "bg-track"}`}
    >
      <span
        className={`absolute top-[3px] left-[3px] size-4 rounded-full shadow-[0_1px_2px_oklch(0%_0_0/0.18)] transition-[translate,background-color] duration-200 ease-snappy ${
          on ? "translate-x-4 bg-white dark:bg-on-ink" : "bg-white"
        }`}
      />
    </button>
  );
}

/** Text button: `primary` is the solid main action of a form; plain is a tinted fill. */
export function Button({ primary, className = "", ...rest }: ButtonProps & { primary?: boolean }) {
  return (
    <button
      {...rest}
      className={`flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[8px] px-3 text-[13px] font-medium whitespace-nowrap disabled:pointer-events-none ${
        primary ? "btn-ink" : "btn text-fg"
      } ${className}`}
    />
  );
}

/** Underlined text action, for secondary choices next to a main button. */
export function TextLink({ className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`w-fit text-[13px] text-muted underline decoration-line-strong underline-offset-[3px] transition-colors hover:text-fg hover:decoration-fg/60 ${className}`}
    />
  );
}

/** Shared look for text inputs and selects: a tinted field that gains an outline and focus ring. */
export const fieldClass =
  "h-8 w-full min-w-0 rounded-[8px] bg-fill px-2.5 text-[13px] select-text outline-none transition-[background-color,box-shadow] duration-150 placeholder:text-faint focus:bg-raised focus:shadow-[inset_0_0_0_1px_var(--line-strong),0_0_0_3px_var(--hover)]";
