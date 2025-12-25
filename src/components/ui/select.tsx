import * as React from "react";

type CtxT = { value: string; setValue: (v: string) => void };
const Ctx = React.createContext<CtxT | null>(null);

export function Select({
  value,
  onValueChange,
  children,
}: {
  value: string;
  onValueChange: (v: string) => void;
  children: React.ReactNode;
}) {
  const ctx = React.useMemo(() => ({ value, setValue: onValueChange }), [value, onValueChange]);
  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

export function SelectTrigger({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">{children}</div>;
}

export function SelectValue({ placeholder }: { placeholder?: string }) {
  const ctx = React.useContext(Ctx);
  return <span className="text-sm">{ctx?.value ? ctx.value : (placeholder ?? "")}</span>;
}

export function SelectContent({ children }: { children: React.ReactNode }) {
  return <div className="mt-2 rounded-xl border border-white/10 bg-[#0f1115] p-2">{children}</div>;
}

export function SelectItem({ value, children }: { value: string; children: React.ReactNode }) {
  const ctx = React.useContext(Ctx);
  if (!ctx) return null;
  return (
    <div className="cursor-pointer rounded-lg px-2 py-2 text-sm hover:bg-white/5" onClick={() => ctx.setValue(value)}>
      {children}
    </div>
  );
}
