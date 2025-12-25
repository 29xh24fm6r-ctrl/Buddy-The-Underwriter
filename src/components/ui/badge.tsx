import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "secondary" | "outline";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  const v =
    variant === "outline"
      ? "border border-white/15 bg-transparent"
      : variant === "secondary"
      ? "bg-white/10 text-white/80"
      : "bg-white/15 text-white";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
        v,
        className
      )}
      {...props}
    />
  );
}
