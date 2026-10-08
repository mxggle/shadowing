// Small shared building blocks. Every pressable thing shrinks a little on press
// (and on its keyboard shortcut, via `flash`) so feedback is consistent.
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useFlash, type FlashId } from "../hooks/useFlash";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { flash?: FlashId };

const pressable =
  "transition-[background-color,color,opacity,scale] duration-150 ease-snappy active:scale-[0.94] data-[flash]:scale-[0.94] disabled:pointer-events-none disabled:opacity-35";

export function IconButton({ active, flash, className = "", ...rest }: ButtonProps & { active?: boolean }) {
  const flashing = useFlash(flash);
  return (
    <button
      {...rest}
      data-flash={flashing || undefined}
      className={`${pressable} flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 ${
        active ? "bg-accent-soft text-accent-text" : "text-muted hover:bg-hover hover:text-fg data-[flash]:bg-press"
      } ${className}`}
    />
  );
}

/** Large round transport button; `primary` is the play button. */
export function RoundButton({ primary, flash, className = "", ...rest }: ButtonProps & { primary?: boolean }) {
  const flashing = useFlash(flash);
  return (
    <button
      {...rest}
      data-flash={flashing || undefined}
      className={`${pressable} grid place-items-center rounded-full ${
        primary
          ? "size-14 bg-accent text-white shadow-[0_4px_14px_-4px] shadow-accent/60 hover:brightness-110"
          : "size-11 text-fg/80 hover:bg-hover hover:text-fg data-[flash]:bg-press"
      } ${className}`}
    />
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-line bg-canvas px-1 font-sans text-[10px] font-medium text-muted">
      {children}
    </kbd>
  );
}

/** − value + group used by the speed and step controls. */
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
    <div className="flex h-8 items-center rounded-lg bg-hover">
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
      className={`${pressable} grid h-8 w-8 shrink-0 place-items-center rounded-lg text-base text-muted hover:bg-hover hover:text-fg data-[flash]:bg-press data-[flash]:text-fg`}
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
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200 ${on ? "bg-accent" : "bg-track"}`}
    >
      <span
        className={`absolute top-[3px] left-[3px] size-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-snappy ${
          on ? "translate-x-4" : ""
        }`}
      />
    </button>
  );
}
