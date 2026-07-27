import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

type DropdownContextValue = {
  openId: string | undefined;
  setOpenId: (id?: string) => void;
};
const DropdownContext = createContext<DropdownContextValue | undefined>(
  undefined,
);

export function DropdownProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [openId, setOpenId] = useState<string>();
  useEffect(() => {
    const close = () => setOpenId(undefined);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, []);
  return (
    <DropdownContext.Provider value={{ openId, setOpenId }}>
      {children}
    </DropdownContext.Provider>
  );
}

export function Dropdown({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  const context = useContext(DropdownContext);
  if (!context) throw new Error("Dropdown requires DropdownProvider");
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const open = context.openId === id;
  const toggle = (event: React.MouseEvent) => {
    event.stopPropagation();
    context.setOpenId(open ? undefined : id);
  };
  const choose = () => {
    context.setOpenId(undefined);
    trigger.current?.focus();
  };
  return (
    <div
      className="dropdown"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        onClick={toggle}
      >
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div
          id={`${id}-menu`}
          className="dropdown-menu"
          role="menu"
          onClick={choose}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
