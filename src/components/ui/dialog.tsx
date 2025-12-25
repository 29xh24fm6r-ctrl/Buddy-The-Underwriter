import * as React from "react";

type DialogCtx = { open: boolean; setOpen: (v: boolean) => void };
const Ctx = React.createContext<DialogCtx | null>(null);

export function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  children: React.ReactNode;
}) {
  const ctx = React.useMemo(() => ({ open, setOpen: onOpenChange }), [open, onOpenChange]);
  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

export function DialogTrigger({ children }: { asChild?: boolean; children: React.ReactNode }) {
  const ctx = React.useContext(Ctx);
  // render children normally; consumers can call setShowOverrideDialog(true) directly if needed
  return (
    <span
      onClick={() => ctx?.setOpen(true)}
      className="inline-flex"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " " ? ctx?.setOpen(true) : null)}
    >
      {children}
    </span>
  );
}

export function DialogContent({ children }: { children: React.ReactNode }) {
  const ctx = React.useContext(Ctx);
  if (!ctx?.open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={() => ctx.setOpen(false)} />
      <div className="relative z-10 w-[min(92vw,520px)] rounded-2xl border border-white/10 bg-[#0f1115] p-6 shadow-[0_20px_80px_rgba(0,0,0,0.6)]">
        {children}
      </div>
    </div>
  );
}

export function DialogHeader({ children }: { children: React.ReactNode }) {
  return <div className="mb-4 space-y-1">{children}</div>;
}
export function DialogTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-lg font-semibold">{children}</div>;
}
export function DialogDescription({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-white/60">{children}</div>;
}
