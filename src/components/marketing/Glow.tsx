"use client";

export function Glow() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -top-24 left-1/2 h-[520px] w-[980px] -translate-x-1/2 rounded-full bg-black/10 blur-3xl" />
      <div className="absolute top-40 left-[10%] h-[320px] w-[420px] rounded-full bg-black/5 blur-3xl" />
      <div className="absolute top-56 right-[12%] h-[300px] w-[380px] rounded-full bg-black/5 blur-3xl" />
    </div>
  );
}
