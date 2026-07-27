import { useEffect, useId, useRef, useState } from "react";

export type TrainingSelectOption<T extends string> = {
  readonly value: T;
  readonly label: string;
};

export function TrainingSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: readonly TrainingSelectOption<T>[];
  readonly onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected =
    options.find((option) => option.value === value) ?? options[0];
  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        close(true);
      }
    };
    const onOtherSelect = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) close();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("training-select-open", onOtherSelect);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("training-select-open", onOtherSelect);
    };
  }, [open]);
  const choose = (next: T) => {
    onChange(next);
    close(true);
  };
  const moveSelection = (offset: number) => {
    const index = Math.max(
      0,
      options.findIndex((option) => option.value === value),
    );
    choose(options[(index + offset + options.length) % options.length]!.value);
  };
  return (
    <div className="training-select" ref={root}>
      <span id={`${id}-label`} className="training-select-label">
        {label}
      </span>
      <button
        ref={trigger}
        type="button"
        className="training-select-trigger"
        aria-labelledby={`${id}-label ${id}-value`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        onClick={() => {
          if (!open)
            window.dispatchEvent(
              new CustomEvent("training-select-open", { detail: id }),
            );
          setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            open ? moveSelection(1) : setOpen(true);
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            open ? moveSelection(-1) : setOpen(true);
          }
        }}
      >
        <span id={`${id}-value`}>{selected?.label}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div
          id={`${id}-listbox`}
          className="training-select-menu"
          role="listbox"
          aria-labelledby={`${id}-label`}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={option.value === value ? "is-active" : undefined}
              onClick={() => choose(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
