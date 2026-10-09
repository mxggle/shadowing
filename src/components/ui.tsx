// Small shared building blocks. Two kinds of pressable thing: quiet "ghost"
// buttons for chrome (icon buttons, links), and raised keys for the things you
// play with. Keys travel down a pixel when pressed, including when their
// keyboard shortcut fires (`flash`), so feedback looks the same either way.
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

/** A raised deck key. `ink` is the play key: the one solid key on the deck. */
export function Key({ ink, flash, className = "", ...rest }: ButtonProps & { ink?: boolean }) {
  const flashing = useFlash(flash);
  return (
    <button
      {...rest}
      data-flash={flashing || undefined}
      className={`grid place-items-center ${ink ? "key-ink" : "key text-fg/80 hover:text-fg"} disabled:pointer-events-none ${className}`}
    />
  );
}

/** A keyboard key, drawn as a small keycap. */
export function Kbd({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={`inline-grid h-[19px] min-w-[19px] place-items-center rounded-[5px] bg-raised px-1 font-sans text-[11px] leading-none font-medium text-muted shadow-[inset_0_-1px_0_var(--line-strong),0_0_0_1px_var(--line)] ${className}`}
    >
      {children}
    </kbd>
  );
}

/** − value + set into a well; used by the speed and step controls. */
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
    <div className="well flex h-8 items-center rounded-[9px] p-0.5">
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
      className="key grid h-7 w-7 shrink-0 place-items-center rounded-[7px] text-[15px] leading-none text-muted hover:text-fg"
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
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full shadow-recess transition-colors duration-200 ${on ? "bg-ink" : "bg-track"}`}
    >
      <span
        className={`absolute top-[3px] left-[3px] size-4 rounded-full shadow-cap transition-[translate,background-color] duration-200 ease-snappy ${
          on ? "translate-x-4 bg-white dark:bg-on-ink" : "bg-white"
        }`}
      />
    </button>
  );
}

/** Text button: `primary` is the solid main action of a form; plain is a raised key. */
export function Button({ primary, className = "", ...rest }: ButtonProps & { primary?: boolean }) {
  return (
    <button
      {...rest}
      className={`flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-[8px] px-3 text-[13px] font-medium whitespace-nowrap disabled:pointer-events-none ${
        primary ? "key-ink" : "key text-fg"
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

/** Shared look for text inputs and selects: a shallow well that lifts to the paper when focused. */
export const fieldClass =
  "h-8 w-full min-w-0 rounded-[8px] bg-sunken px-2.5 text-[13px] shadow-recess select-text outline-none transition-[background-color,box-shadow] duration-150 placeholder:text-faint focus:bg-raised focus:shadow-[0_0_0_1px_var(--line-strong),0_0_0_4px_var(--hover)]";
